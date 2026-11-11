// Starter 2: fork one prepared sandbox N times, run a different command in each fork,
// score each fork, keep the winner. This is the skeleton of ideas A1, A5, A7, and A8.
// Based on docs.archil.com/guides/agents/parallel-agents.
//
// Run:  npm install && npm run forks
// Replace APPROACHES with agent runs when the skeleton works.
import * as archil from "disk";

archil.configure({
  apiKey: process.env.ARCHIL_API_KEY,
  region: process.env.ARCHIL_REGION ?? "aws-us-west-2",
});

const APPROACHES = [
  { name: "sort-builtin", cmd: "python -c \"import time;t=time.time();sorted(range(10**6,0,-1));print(round((time.time()-t)*1000))\"" },
  { name: "sort-heap", cmd: "python -c \"import time,heapq;t=time.time();h=list(range(10**6,0,-1));heapq.heapify(h);[heapq.heappop(h) for _ in range(len(h))];print(round((time.time()-t)*1000))\"" },
  { name: "sort-loop", cmd: "python -c \"import time;t=time.time();a=list(range(10**5,0,-1));a.sort();print(round((time.time()-t)*1000))\"" },
];

// 1. Prepare a base sandbox, then stop it. A stopped base costs no compute.
const base = await archil.createSandbox({
  name: `race-base-${Date.now()}`,
  baseImage: "python:3.13",
  vcpuCount: 1,
  memSizeMiB: 1024,
});
const setup = await base.exec("mkdir -p /app && echo ready > /app/state.txt", { cwd: "/" });
if (setup.exitCode !== 0) throw new Error(setup.stderr);
await base.stop();

// 2. Fork once per approach and time the forks.
const t0 = Date.now();
const forks = await Promise.all(APPROACHES.map(({ name }) => base.fork({ name: `${base.name}-${name}` })));
console.log(`Forked ${forks.length} sandboxes in ${Date.now() - t0} ms`);

// 3. Run each approach in its own fork and score it.
const results = await Promise.all(
  forks.map(async (sandbox, i) => {
    const r = await sandbox.exec(APPROACHES[i].cmd, { cwd: "/app", timeoutSeconds: 120 });
    const ms = r.exitCode === 0 ? Number(r.stdout.trim()) : Infinity;
    console.log(`  ${APPROACHES[i].name.padEnd(14)} ${ms} ms`);
    return { sandbox, name: APPROACHES[i].name, ms };
  }),
);

// 4. Keep the winner. Delete the others, then the base (forks must go first).
results.sort((a, b) => a.ms - b.ms);
const [winner, ...losers] = results;
console.log(`Winner: ${winner.name}`);
for (const { sandbox } of results) {
  await sandbox.stop();
  await sandbox.delete();
}
await base.delete();
