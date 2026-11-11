// Ticket 01: does "fork per checker" work on the live Archil service?
// Base python:3.13 sandbox with a tiny repo in /app, stopped, forked 3 times,
// one checker command per fork. Every sandbox is deleted in finally.
//
// Run: npx tsx --env-file-if-exists=.env fork-check.ts
import * as archil from "disk";

archil.configure({
  apiKey: process.env.ARCHIL_API_KEY,
  region: process.env.ARCHIL_REGION ?? "aws-us-west-2",
});

const REPO: Record<string, string> = {
  "/app/requirements.txt": "requests\nhuggingface-cli\n",
  "/app/main.py":
    'import subprocess\nimport requests\n\n\ndef fetch(url):\n    return requests.get(url, verify=False).text\n\n\ndef run(cmd):\n    return subprocess.call(cmd, shell=True)\n',
  "/app/README.md": "# tiny repo\nFixture for fork-check.ts\n",
};

const CHECKERS = [
  { name: "a-bandit", cmd: "pip install -q bandit && bandit -r /app -f json" },
  {
    name: "b-pypi",
    cmd:
      "curl -s -o /dev/null -w '%{http_code}' https://pypi.org/pypi/huggingface-cli/json; echo; " +
      "curl -s -o /dev/null -w '%{http_code}' https://pypi.org/pypi/requests/json; echo; " +
      "curl -s -m 10 -o /dev/null -w '%{http_code}' https://pypistats.org/api/packages/requests/recent",
  },
  { name: "c-ls", cmd: "ls -R /app && python --version" },
];

const trunc = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + `... [${s.length} chars]` : s);
const tStart = Date.now();
const created: archil.Sandbox[] = [];
const timings: Record<string, number> = {};

try {
  let t = Date.now();
  const base = await archil.createSandbox({
    name: `fc-base-${Date.now()}`,
    baseImage: "python:3.13",
    vcpuCount: 1,
    memSizeMiB: 1024,
    maxTtlSeconds: 900,
  });
  created.push(base);
  timings.create = Date.now() - t;

  // Write the repo. Try the SDK upload first, fall back to exec + heredoc.
  t = Date.now();
  let writeMethod = "sandbox.files.uploadFile";
  try {
    await base.exec("mkdir -p /app", { cwd: "/" });
    for (const [p, body] of Object.entries(REPO)) {
      await base.files.uploadFile(new TextEncoder().encode(body), p);
    }
  } catch (e) {
    console.log(`uploadFile failed: ${(e as Error).message}; falling back to heredoc`);
    writeMethod = "exec heredoc";
    for (const [p, body] of Object.entries(REPO)) {
      const r = await base.exec(`cat > ${p} <<'EOF'\n${body}EOF`, { cwd: "/" });
      if (r.exitCode !== 0) throw new Error(r.stderr);
    }
  }
  const verify = await base.exec("wc -c /app/*", { cwd: "/" });
  timings.writeRepo = Date.now() - t;
  console.log(`Repo written via ${writeMethod}:\n${verify.stdout}`);

  t = Date.now();
  await base.stop();
  timings.stopBase = Date.now() - t;

  t = Date.now();
  const forks = await Promise.all(CHECKERS.map(({ name }) => base.fork({ name: `${base.name}-${name}` })));
  created.push(...forks);
  timings.fork3 = Date.now() - t;
  console.log(`Forked ${forks.length} sandboxes in ${timings.fork3} ms (statuses: ${forks.map((f) => f.status).join(", ")})`);

  const tExec = Date.now();
  const results = await Promise.all(
    forks.map(async (sb, i) => {
      const t0 = Date.now();
      try {
        const r = await sb.exec(CHECKERS[i].cmd, { cwd: "/app", timeoutSeconds: 180 });
        return { name: CHECKERS[i].name, ms: Date.now() - t0, ...r };
      } catch (e) {
        return { name: CHECKERS[i].name, ms: Date.now() - t0, exitCode: -1, stdout: "", stderr: `THREW: ${(e as Error).message}` };
      }
    }),
  );
  timings.execAllParallel = Date.now() - tExec;

  for (const r of results) {
    console.log(`\n=== ${r.name}: exit ${r.exitCode} in ${r.ms} ms`);
    console.log(`stdout: ${trunc(r.stdout)}`);
    if (r.stderr) console.log(`stderr: ${trunc(r.stderr, 400)}`);
    timings[`exec_${r.name}`] = r.ms;
  }
  const bandit = results[0];
  try {
    const j = JSON.parse(bandit.stdout);
    console.log(`bandit issues: ${j.results.length}: ${j.results.map((x: any) => x.test_id).join(",")}`);
  } catch {}

  try {
    const net = await forks[1].getNetwork();
    console.log(`\ngetNetwork (fork B): ${JSON.stringify(net)}`);
  } catch (e) {
    console.log(`getNetwork failed: ${(e as Error).message}`);
  }
} catch (e) {
  console.error("ERROR:", e);
  process.exitCode = 1;
} finally {
  // Forks first, then the base.
  for (const sb of created.slice(1).concat(created.slice(0, 1))) {
    try {
      await sb.stop().catch(() => {});
      await sb.delete();
      console.log(`deleted ${sb.name}`);
    } catch (e) {
      console.error(`DELETE FAILED ${sb.name} (${sb.id}): ${(e as Error).message}`);
    }
  }
  timings.total = Date.now() - tStart;
  console.log(`\nTimings (ms): ${JSON.stringify(timings)}`);
}
