// Swarm orchestrator: deploy N role-specialist agents over the repo.
// Modes:
//   isolated  one base sandbox, one fork per agent. Own CPU, no shared state.
//   shared    one sandbox, every agent runs commands in it. Shared state, shared CPU.
//   disk      one Archil disk, every command runs in its own fresh VM with the disk mounted. Own CPU, shared state.
// Usage: npm run swarm -- [--agents N] [--mode isolated|shared|disk] [--timeout SECONDS] [--repo PATH] [--run-id ID]
// Writes runs/<run-id>/events.jsonl (UI contract), runs/<run-id>/findings/<role>.jsonl, and runs the scorecard.
import * as archil from "disk";
import type { Disk, Sandbox } from "disk";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRepoSandbox, destroy } from "../sandbox.ts";
import { REPO_DIR, type Finding } from "../types.ts";
import { runAgent, SHARED_DIR, type AgentResult, type Exec } from "./agent.ts";
import { EventLog, type Mode } from "./events.ts";
import { planSwarm, ROLES } from "./roles.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values: args } = parseArgs({
  options: {
    agents: { type: "string", default: "3" },
    mode: { type: "string", default: "isolated" },
    timeout: { type: "string", default: "180" },
    repo: { type: "string", default: join(ROOT, "..", "demo-repo") },
    "run-id": { type: "string" },
  },
});
const N = Number(args.agents);
const mode = args.mode as Mode;
const TIMEOUT_MS = Number(args.timeout) * 1000;
if (!Number.isInteger(N) || N < 1 || N > 24) throw new Error("--agents must be an integer from 1 to 24");
if (!["isolated", "shared", "disk"].includes(mode)) throw new Error("--mode must be isolated, shared or disk");

const repo = resolve(args.repo!);
const runId = args["run-id"] ?? `swarm-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const runDir = join(ROOT, "..", "runs", runId);
const events = new EventLog(runDir);
const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";
const b64 = (s: string) => Buffer.from(s).toString("base64");
const PACKAGE_CHECK = readFileSync(join(ROOT, "src", "checkers", "package_check.py"));
const SETUP_SHARED = `mkdir -p ${SHARED_DIR}/notes ${SHARED_DIR}/findings`;
const SKIP = new Set(["__pycache__", ".pytest_cache", ".git", "node_modules", ".venv", "venv"]);
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (SKIP.has(n) ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

// ---- sandbox modes (isolated, shared) ----

const sandboxExec =
  (sb: Sandbox): Exec =>
  async (command, timeoutSeconds) => {
    const r = await sb.exec(command, { cwd: REPO_DIR, timeoutSeconds });
    return { exitCode: r.exitCode ?? -1, stdout: r.stdout, stderr: r.stderr };
  };

async function prepareSandbox(): Promise<Sandbox> {
  const base = await createRepoSandbox(repo, `${runId}-base`.toLowerCase());
  await base.exec("mkdir -p /opt/tools", { cwd: "/" });
  await base.files.uploadFile(new Uint8Array(PACKAGE_CHECK), "/opt/tools/package_check.py");
  const setup = await base.exec(`pip install -q --disable-pip-version-check bandit && ${SETUP_SHARED}`, { cwd: "/", timeoutSeconds: 120 });
  if (setup.exitCode !== 0) console.warn(`setup warning: ${setup.stderr.slice(0, 300)}`);
  return base;
}

// ---- disk mode ----
// Disk layout (mounted at /mnt/archil/ws in every exec VM):
//   app/      the repo        -> symlinked to /app
//   swarm/    notes, findings -> symlinked to /swarm
//   tools/    bandit (pip --target) and package_check.py -> /opt/tools, on PATH and PYTHONPATH
const MNT = "/mnt/archil/ws";
const DISK_PRELUDE = [
  `mkdir -p ${MNT}/swarm/notes ${MNT}/swarm/findings ${MNT}/tools`, // a link to a missing folder breaks mkdir -p /swarm/...
  `ln -sfn ${MNT}/app ${REPO_DIR}`,
  `ln -sfn ${MNT}/swarm ${SHARED_DIR}`,
  `mkdir -p /opt && ln -sfn ${MNT}/tools /opt/tools`,
  `export PYTHONPATH=/opt/tools/py PATH=/opt/tools/py/bin:$PATH PIP_ROOT_USER_ACTION=ignore`,
].join(" && ");

const diskExec =
  (disk: Disk): Exec =>
  async (command, timeoutSeconds) => {
    // The prelude makes /app, /swarm and /opt/tools look the same as in a sandbox, so prompts and paths do not change.
    const script = `${DISK_PRELUDE}\ncd ${REPO_DIR}\n${command}\n`;
    const r = await archil.exec({
      disks: { ws: { disk, conditional: true } } as never,
      command: `echo ${b64(script)} | base64 -d > /tmp/cmd.sh && timeout ${timeoutSeconds} bash /tmp/cmd.sh`,
    });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  };

async function prepareDisk(): Promise<Disk> {
  const { disk } = await archil.createDisk({ name: `${runId}-disk`.toLowerCase() });
  const files = walk(repo);
  await Promise.all([
    ...files.map((f) => disk.putObject(`app/${relative(repo, f)}`, new Uint8Array(readFileSync(f)))),
    disk.putObject("tools/package_check.py", new Uint8Array(PACKAGE_CHECK)),
  ]);
  const setup = await diskExec(disk)(`pip install -q --disable-pip-version-check --target /opt/tools/py bandit && ${SETUP_SHARED}`, 180);
  if (setup.exitCode !== 0) console.warn(`setup warning: ${setup.stderr.slice(-300)}`);
  return disk;
}

// ---- run ----

const t0 = Date.now();
let base: Sandbox | undefined;
let disk: Disk | undefined;
const forks: Sandbox[] = [];
const results: (AgentResult & { id: string })[] = [];

try {
  console.log(`Swarm ${runId}: ${N} agent(s), ${mode} mode, repo ${repo}`);
  console.log(`Events: ${events.path}`);

  let exec0: Exec;
  if (mode === "disk") {
    disk = await prepareDisk();
    exec0 = diskExec(disk);
  } else {
    base = await prepareSandbox();
    exec0 = sandboxExec(base);
  }
  const ls = await exec0(`find . -type f -not -path '*/__pycache__/*' -not -path './.git/*' | sed 's|^\\./||' | sort`, 30);
  const files = ls.stdout.split("\n").filter(Boolean);
  console.log(`${mode === "disk" ? `Disk ${disk!.id}` : `Base ${base!.name}`} ready with ${files.length} files in ${secs(Date.now() - t0)}`);

  const plans = planSwarm(N, files);
  events.emit({ type: "run_started", run_id: runId, repo, mode, checkers: plans.map((p) => p.id), agents: plans });
  for (const p of plans) console.log(`  ${p.id.padEnd(28)} ${p.roles.map((r) => `${r}:${p.files[r].length}`).join(" ")}`);

  // Give every agent a way to run commands.
  const execs: Exec[] = [];
  if (mode === "isolated") {
    await base!.stop();
    const made = await Promise.allSettled(
      plans.map(async (p) => {
        const t = Date.now();
        const sb = await base!.fork({ name: `${base!.name}-${p.id}`.toLowerCase().replace(/[^a-z0-9-]/g, "-") });
        forks.push(sb);
        events.emit({ type: "fork_started", checker: p.id, role: p.roles.join("+"), sandbox_id: sb.name, fork_ms: Date.now() - t, shared: false });
        return sb;
      }),
    );
    const failed = made.find((m) => m.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
    execs.push(...made.map((m) => sandboxExec((m as PromiseFulfilledResult<Sandbox>).value)));
  } else {
    const id = mode === "disk" ? disk!.id : base!.name;
    for (const p of plans) {
      execs.push(exec0);
      events.emit({ type: "fork_started", checker: p.id, role: p.roles.join("+"), sandbox_id: id, fork_ms: 0, shared: true });
    }
  }
  const how = { isolated: `Forked ${forks.length} sandboxes`, shared: "Agents share one sandbox", disk: "Agents share one disk, one VM per command" }[mode];
  console.log(`${how} at ${secs(Date.now() - t0)}`);

  await Promise.all(
    plans.map(async (plan, i) => {
      const start = Date.now();
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const peers = plans.filter((p) => p !== plan).map((p) => p.id);
      try {
        const r = await runAgent({ plan, exec: execs[i], mode, peers, events, signal });
        results.push({ id: plan.id, ...r });
        events.emit({ type: "fork_done", checker: plan.id, exit_code: 0, duration_ms: Date.now() - start, findings: r.findings.length, steps: r.steps });
        console.log(`  ${plan.id.padEnd(28)} done in ${secs(Date.now() - start)}: ${r.findings.length} findings, ${r.steps} steps`);
      } catch (e) {
        const msg = (e as Error).message;
        events.emit({ type: "fork_done", checker: plan.id, exit_code: 1, duration_ms: Date.now() - start, findings: 0, steps: 0, error: msg });
        console.log(`  ${plan.id.padEnd(28)} FAILED after ${secs(Date.now() - start)}: ${msg}`);
      }
    }),
  );
  if (disk) {
    const shared = await exec0(`cat ${SHARED_DIR}/findings/*.jsonl 2>/dev/null | python3 -c "import sys,json,collections;c=collections.Counter(json.loads(l)['agent'] for l in sys.stdin if l.strip());print(chr(10).join(f'{a}: {n} finding(s)' for a,n in sorted(c.items())))"`, 30);
    console.log(`\nFindings on the shared disk:\n${shared.stdout.trim() || "(none)"}`);
    const notes = await exec0(`cat ${SHARED_DIR}/notes/* 2>/dev/null | head -40`, 30);
    if (notes.stdout.trim()) console.log(`\nSwarm notes on the disk:\n${notes.stdout.trim()}`);
  }
} catch (e) {
  console.error(`Swarm failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  console.log("Cleaning up");
  await destroy(...forks, ...(base ? [base] : []));
  if (disk) await disk.delete().catch((e) => console.error(`DELETE FAILED ${disk!.id}: ${(e as Error).message}`));
}

// Merge per role, drop exact duplicates across agents, and score.
const findingsDir = join(runDir, "findings");
mkdirSync(findingsDir, { recursive: true });
const all = results.flatMap((r) => r.findings);
for (const role of ROLES) {
  const seen = new Set<string>();
  const mine = all.filter((f) => f.checker === role.name && !seen.has(`${f.file}:${f.line}:${f.class}`) && seen.add(`${f.file}:${f.line}:${f.class}`));
  writeFileSync(join(findingsDir, `${role.name}.jsonl`), mine.map((f: Finding) => JSON.stringify(f) + "\n").join(""));
}
console.log(`Total ${secs(Date.now() - t0)}, ${all.length} findings before dedupe\n`);

const scorecard = join(ROOT, "src", "scorecard.py");
const scoreFile = join(runDir, "score.json");
if (existsSync(scorecard)) {
  spawnSync("python3", ["-I", scorecard, "--findings-dir", findingsDir, "--json", scoreFile], { stdio: "inherit", cwd: ROOT });
  if (existsSync(scoreFile)) events.emit({ type: "score", ...JSON.parse(readFileSync(scoreFile, "utf8")) });
}
process.exit(process.exitCode ?? 0);
