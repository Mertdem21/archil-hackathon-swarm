// Shared sandbox helpers: upload the target repo into a base sandbox, fork it, clean up.
import * as archil from "disk";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_DIR } from "./types.ts";

archil.configure({
  apiKey: process.env.ARCHIL_API_KEY,
  region: process.env.ARCHIL_REGION ?? "aws-us-west-2",
});

const SKIP = new Set(["__pycache__", ".pytest_cache", ".git", "node_modules", ".venv", "venv"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Create a python:3.13 sandbox and upload every file of localRepo to REPO_DIR. */
export async function createRepoSandbox(localRepo: string, name = `scan-${Date.now()}`): Promise<archil.Sandbox> {
  const sb = await archil.createSandbox({ name, baseImage: "python:3.13", vcpuCount: 1, memSizeMiB: 1024, maxTtlSeconds: 900 });
  const files = walk(localRepo);
  const dirs = [...new Set(files.map((f) => join(REPO_DIR, relative(localRepo, f), "..")))];
  await sb.exec(`mkdir -p ${dirs.join(" ")}`, { cwd: "/" });
  for (const f of files) {
    await sb.files.uploadFile(new Uint8Array(readFileSync(f)), join(REPO_DIR, relative(localRepo, f)));
  }
  return sb;
}

/** Stop and delete sandboxes. Pass forks before their base. Never throws. */
export async function destroy(...sandboxes: archil.Sandbox[]): Promise<void> {
  for (const sb of sandboxes) {
    try {
      await sb.stop().catch(() => {});
      await sb.delete();
    } catch (e) {
      console.error(`DELETE FAILED ${sb.name}: ${(e as Error).message}`);
    }
  }
}
