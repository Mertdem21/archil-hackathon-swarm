// One swarm agent: a tool loop with bash in its sandbox and a report_finding tool.
// Claude runs on the host; only the bash commands run in the sandbox.
import { stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { anthropic, MODEL } from "../llm.ts";
import { REPO_DIR, type Finding } from "../types.ts";
import type { AgentPlan, EventLog, Mode } from "./events.ts";
import { roleByName } from "./roles.ts";

export const SHARED_DIR = "/swarm"; // notes and findings all agents can see in shared and disk modes
const MAX_STEPS = 30;
const OUTPUT_LIMIT = 12_000;

const clip = (s: string, n = OUTPUT_LIMIT) => (s.length > n ? s.slice(0, n) + `\n...[${s.length - n} more chars cut]` : s);
const rel = (p: string) => p.replace(new RegExp(`^${REPO_DIR}/`), "").replace(/^\.\//, "");
const b64 = (s: string) => Buffer.from(s).toString("base64");

function instructions(plan: AgentPlan, mode: Mode, peers: string[]): string {
  const roles = plan.roles.map(roleByName);
  const parts = [
    `You are ${plan.id}, one agent in a swarm that audits a vibe-coded Python repository at ${REPO_DIR}.`,
    `You have a bash tool that runs in a Linux VM (python 3, network access). Each call starts in ${REPO_DIR}. bandit and /opt/tools/package_check.py are installed.`,
    `Report every real bug with report_finding, one call per bug, as soon as you confirm it. Then keep looking.`,
    `"file" is relative to the repo root (for example app/db.py). "line" is where the dangerous call, literal, or copy starts; get it from nl -ba.`,
    `Precision matters: a false alarm costs as much as a miss. Do not report guesses, style issues, or anything outside your classes.`,
    `When you have covered your files, stop calling tools and reply with a one-line summary.`,
  ];
  for (const r of roles) {
    const files = plan.files[r.name] ?? [];
    parts.push(
      `\n## Role: ${r.name}\nClasses you may report: ${r.classes.join(", ")}.\n` +
        `Files you own for this role (${files.length}): ${files.join(", ") || "(none)"}.\n` +
        `Report only bugs located in files you own. You may read any other file for context.\n${r.playbook}`,
    );
  }
  if (mode !== "isolated") {
    const where = mode === "disk" ? "one Archil disk (each of your commands runs in its own fresh VM with the disk mounted)" : "one sandbox";
    parts.push(
      `\n## Shared workspace\nYou share ${where} with: ${peers.join(", ") || "nobody"}. They own other files or roles.`,
      `${SHARED_DIR}/findings/*.jsonl lists every finding reported so far by any agent (one file per finding). Run cat ${SHARED_DIR}/findings/*.jsonl before you report, and skip bugs that are already there.`,
      `${SHARED_DIR}/notes/ is the swarm scratchpad. Write each short note that helps others as a NEW file named ${SHARED_DIR}/notes/${plan.id}-<n>.md, never by appending (for example "app/utils.py: format_price is a copy of app/money.py:12"). Read cat ${SHARED_DIR}/notes/* now and then.`,
      `Do not modify files under ${REPO_DIR}.`,
    );
  } else {
    parts.push(`\nYou work in your own isolated fork of the sandbox. Feel free to install tools or run the code; nothing you do affects other agents.`);
  }
  return parts.join("\n");
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
/** Runs one shell command for an agent: in its fork, in the shared sandbox, or in a fresh VM on the shared disk. */
export type Exec = (command: string, timeoutSeconds: number) => Promise<ExecResult>;

export interface AgentRun {
  plan: AgentPlan;
  exec: Exec;
  mode: Mode;
  peers: string[];
  events: EventLog;
  signal: AbortSignal;
}

export interface AgentResult {
  findings: Finding[];
  steps: number;
  summary: string;
}

export async function runAgent({ plan, exec, mode, peers, events, signal }: AgentRun): Promise<AgentResult> {
  const classes = plan.roles.flatMap((r) => roleByName(r).classes) as [string, ...string[]];
  const roleOf = (cls: string) => plan.roles.find((r) => (roleByName(r).classes as readonly string[]).includes(cls))!;
  const owned = new Set(Object.values(plan.files).flat());
  const findings: Finding[] = [];
  const checker = plan.id;

  const tools = {
    bash: tool({
      description: `Run a shell command in the sandbox. Working directory is ${REPO_DIR}. Output is truncated at ${OUTPUT_LIMIT} characters.`,
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        const r = await exec(command, 60);
        return { exit_code: r.exitCode, stdout: clip(r.stdout), stderr: clip(r.stderr, 3000) };
      },
    }),
    report_finding: tool({
      description: "Report one confirmed bug. Call once per bug.",
      inputSchema: z.object({
        file: z.string().describe("Path relative to the repo root, e.g. app/db.py"),
        line: z.number().int(),
        class: z.enum(classes),
        reason: z.string().describe("One sentence"),
        evidence: z.string().describe("The offending line of code, short"),
      }),
      execute: async (input) => {
        const file = rel(input.file);
        if (!owned.has(file)) return { accepted: false, why: `${file} is not one of your files. Leave it to its owner.` };
        if (findings.some((f) => f.file === file && f.line === input.line && f.class === input.class)) {
          return { accepted: false, why: "You already reported this." };
        }
        const role = roleOf(input.class);
        const f: Finding = { checker: role as Finding["checker"], file, line: input.line, class: input.class, reason: input.reason, evidence: input.evidence.slice(0, 300) };
        findings.push(f);
        events.emit({ type: "finding", checker, role, file, line: f.line, class: f.class, reason: f.reason, evidence: f.evidence });
        if (mode !== "isolated") {
          // One new file per finding. On a conditional disk mount, appends from parallel VMs to one file overwrite each other.
          const line = JSON.stringify({ agent: checker, file, line: f.line, class: f.class }) + "\n";
          await exec(`echo ${b64(line)} | base64 -d > ${SHARED_DIR}/findings/${checker}-${findings.length}.jsonl`, 30);
        }
        return { accepted: true };
      },
    }),
  };

  const agent = new ToolLoopAgent({
    model: anthropic(MODEL),
    instructions: instructions(plan, mode, peers),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  let steps = 0;
  const result = await agent.generate({
    prompt: `Start your audit. Your roles: ${plan.roles.join(", ")}.`,
    abortSignal: signal,
    onStepEnd: () => {
      steps++;
    },
    onToolExecutionEnd: (e) => {
      const input = e.toolCall.input as Record<string, unknown>;
      const summary = e.toolCall.toolName === "bash" ? String(input.command) : `${input.class} ${input.file}:${input.line}`;
      events.emit({ type: "tool_call", checker, tool: e.toolCall.toolName, input: summary.slice(0, 400), ms: Math.round(e.toolExecutionMs), ok: !("error" in e && e.error) });
    },
  });
  const summary = result.text.trim().split("\n")[0]?.slice(0, 300) ?? "";
  if (summary) events.emit({ type: "log", checker, text: summary });
  return { findings, steps, summary };
}
