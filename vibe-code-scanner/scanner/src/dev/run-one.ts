// Dev helper: run one checker against demo-repo in a fresh sandbox.
// Usage: npx tsx --env-file-if-exists=.env src/dev/run-one.ts <checker-module-name>
import { createRepoSandbox, destroy } from "../sandbox.ts";
import type { Checker } from "../types.ts";

const name = process.argv[2];
if (!name) {
  console.error("usage: run-one.ts <checker> (security | package | testcheat)");
  process.exit(1);
}

const mod = (await import(`../checkers/${name}.ts`)) as { run: Checker };
const t0 = Date.now();
const sb = await createRepoSandbox("../demo-repo", `dev-${name}-${Date.now()}`);
console.log(`sandbox ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
try {
  const t1 = Date.now();
  const findings = await mod.run({ sandbox: sb, log: (l) => console.log(`[${name}] ${l}`) });
  console.log(`checker took ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(findings, null, 2));
} finally {
  await destroy(sb);
}
