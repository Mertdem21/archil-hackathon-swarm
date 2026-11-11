// Package checker: runs package_check.py inside the fork. No LLM.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPO_DIR, type Checker, type Finding } from "../types.ts";

const SCRIPT = readFileSync(fileURLToPath(new URL("./package_check.py", import.meta.url)));
const REMOTE = "/tmp/package_check.py";

export const run: Checker = async ({ sandbox, log }) => {
  log(`uploading package_check.py to ${REMOTE}`);
  await sandbox.files.uploadFile(new Uint8Array(SCRIPT), REMOTE);

  log("checking requirements.txt and imports against PyPI");
  const r = await sandbox.exec(`python3 ${REMOTE} ${REPO_DIR}`, { cwd: "/", timeoutSeconds: 110 });
  for (const line of r.stderr.split("\n")) if (line.trim()) log(line);
  if (r.exitCode !== 0) log(`package_check.py exited with code ${r.exitCode}`);

  const findings: Finding[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const f = JSON.parse(line) as Finding;
      findings.push({ ...f, checker: "package" });
      log(`FOUND ${f.class} ${f.file}:${f.line}`);
    } catch {
      log(`ignored non-JSON output: ${line.slice(0, 120)}`);
    }
  }
  log(`done: ${findings.length} findings`);
  return findings;
};
