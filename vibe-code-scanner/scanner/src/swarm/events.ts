// Writes runs/<run-id>/events.jsonl, the contract the UI reads (see README.md).
// One JSON object per line, appended as things happen, so the UI can tail the file.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SwarmEvent =
  | { type: "run_started"; run_id: string; repo: string; mode: Mode; checkers: string[]; agents: AgentPlan[] }
  | { type: "fork_started"; checker: string; role: string; sandbox_id: string; fork_ms: number; shared: boolean }
  | { type: "log"; checker: string; text: string }
  | { type: "tool_call"; checker: string; tool: string; input: string; ms: number; ok: boolean }
  | { type: "finding"; checker: string; role: string; file: string; line: number; class: string; reason: string; evidence: string }
  | { type: "fork_done"; checker: string; exit_code: number; duration_ms: number; findings: number; steps: number; error?: string }
  | { type: "score"; caught: number; total: number; false_alarms: number; missed: string[] };

export type Mode = "isolated" | "shared" | "disk";

export interface AgentPlan {
  id: string; // e.g. "security-1"; used as `checker` in every event
  roles: string[];
  files: Record<string, string[]>; // role -> files this agent owns for that role
}

export class EventLog {
  readonly path: string;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "events.jsonl");
    writeFileSync(this.path, "");
  }
  emit(e: SwarmEvent) {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n");
  }
}
