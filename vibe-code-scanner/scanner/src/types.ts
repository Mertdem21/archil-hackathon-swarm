// Shared contract for every checker. Do not change without updating BUILD.md.
import type { Sandbox } from "disk";

export const BUG_CLASSES = [
  "sql-injection",
  "xss",
  "hardcoded-secret",
  "command-injection",
  "hallucinated-package",
  "undeclared-import",
  "special-casing",
  "empty-test",
  "duplicated-code",
] as const;
export type BugClass = (typeof BUG_CLASSES)[number];

export type CheckerName = "security" | "package" | "test-cheat";

// One line of out/findings/<checker>.jsonl
export interface Finding {
  checker: CheckerName;
  file: string; // path relative to the repo root, e.g. "app/db.py"
  line: number;
  class: BugClass | string; // unknown classes count as false alarms
  reason: string;
  evidence: string; // the offending code or tool output, short
}

// The repo is uploaded to this path in the base sandbox, so it exists in every fork.
export const REPO_DIR = "/app";

export interface CheckerContext {
  sandbox: Sandbox; // this checker's own fork
  log: (line: string) => void; // appends to out/logs/<checker>.log
}

export type Checker = (ctx: CheckerContext) => Promise<Finding[]>;
