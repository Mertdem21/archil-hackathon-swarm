// Orchestrator: upload the repo into a base sandbox, fork it 3 times,
// run one checker per fork in parallel, write findings and logs, then score.
// Usage: npm run scan [-- <local repo path>]   (default ../demo-repo)
import type { Sandbox } from "disk";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepoSandbox, destroy } from "./sandbox.ts";
import type { Checker, CheckerName, Finding } from "./types.ts";
import { run as security } from "./checkers/security.ts";
import { run as pkg } from "./checkers/package.ts";
import { run as testcheat } from "./checkers/testcheat.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const TIMEOUT_MS = 120_000;
const CHECKERS: { name: CheckerName; run: Checker }[] = [
  { name: "security", run: security },
  { name: "package", run: pkg },
  { name: "test-cheat", run: testcheat },
];

const repo = resolve(process.argv[2] ?? join(ROOT, "..", "demo-repo"));
const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";
const stamp = () => new Date().toISOString().slice(11, 23);

mkdirSync(join(OUT, "logs"), { recursive: true });
mkdirSync(join(OUT, "findings"), { recursive: true });
for (const { name } of CHECKERS) {
  writeFileSync(join(OUT, "logs", `${name}.log`), "");
  writeFileSync(join(OUT, "findings", `${name}.jsonl`), "");
}

function logger(name: string) {
  const file = join(OUT, "logs", `${name}.log`);
  return (line: string) => appendFileSync(file, `[${stamp()}] ${line}\n`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const t0 = Date.now();
let base: Sandbox | undefined;
let forks: Sandbox[] = [];
const results: { name: string; ok: boolean; count: number; ms: number; error?: string }[] = [];
const timings: Record<string, number> = {};

try {
  console.log(`Scanning ${repo}`);
  let t = Date.now();
  base = await createRepoSandbox(repo);
  await base.stop();
  timings.base = Date.now() - t;
  console.log(`Base sandbox ${base.name} ready and stopped in ${secs(timings.base)}`);

  t = Date.now();
  const settled = await Promise.allSettled(CHECKERS.map(({ name }) => base!.fork({ name: `${base!.name}-${name}` })));
  forks = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  timings.fork = Date.now() - t;
  console.log(`Forked ${forks.length} sandboxes in ${secs(timings.fork)}`);
  const failedFork = settled.find((s) => s.status === "rejected");
  if (failedFork) throw (failedFork as PromiseRejectedResult).reason;

  t = Date.now();
  await Promise.all(
    CHECKERS.map(async ({ name, run }, i) => {
      const log = logger(name);
      const start = Date.now();
      log(`start in fork ${forks[i].name}`);
      try {
        const findings: Finding[] = await withTimeout(run({ sandbox: forks[i], log }), TIMEOUT_MS);
        writeFileSync(join(OUT, "findings", `${name}.jsonl`), findings.map((f) => JSON.stringify(f) + "\n").join(""));
        log(`finished: ${findings.length} findings in ${secs(Date.now() - start)}`);
        results.push({ name, ok: true, count: findings.length, ms: Date.now() - start });
      } catch (e) {
        const msg = (e as Error).message;
        writeFileSync(join(OUT, "findings", `${name}.jsonl`), "");
        log(`FAILED: ${msg}`);
        results.push({ name, ok: false, count: 0, ms: Date.now() - start, error: msg });
      }
      console.log(`  ${name} done in ${secs(Date.now() - start)}`);
    }),
  );
  timings.checkers = Date.now() - t;

  console.log("\nSummary");
  for (const r of results) {
    const status = r.ok ? `${r.count} findings` : `FAILED (${r.error})`;
    console.log(`  ${r.name.padEnd(11)} ${secs(r.ms).padStart(7)}  ${status}`);
  }
  console.log(`  base ${secs(timings.base)}, fork ${secs(timings.fork)}, checkers ${secs(timings.checkers)}`);
} catch (e) {
  console.error(`Scan failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  console.log("Cleaning up sandboxes");
  await destroy(...forks, ...(base ? [base] : []));
  console.log(`Total ${secs(Date.now() - t0)}`);
}

const scorecard = join(ROOT, "src", "scorecard.py");
if (existsSync(scorecard)) {
  console.log("");
  spawnSync("python3", ["-I", scorecard], { stdio: "inherit", cwd: ROOT });
}
// A timed-out checker may still hold an open connection; do not wait for it.
process.exit(process.exitCode ?? 0);
