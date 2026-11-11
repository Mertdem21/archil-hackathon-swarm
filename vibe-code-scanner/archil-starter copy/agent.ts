// Starter 1: an agent with a persistent Archil disk as its workspace.
// Based on the Archil quickstart (docs.archil.com/getting-started/quickstart).
// Every tool call is appended to an audit log on the disk.
//
// Run:  npm install && npm run agent -- "your task here"
import * as archil from "disk";
import { createAnthropic } from "@ai-sdk/anthropic";
import { execSync } from "node:child_process";

// Use ANTHROPIC_API_KEY if it is set. Otherwise use the login from `ant auth login`.
// The ant CLI refreshes the login token, so we ask it again every 5 minutes.
let cachedToken = { value: "", at: 0 };
const antToken = () => {
  if (Date.now() - cachedToken.at > 5 * 60_000) {
    cachedToken = {
      value: execSync("ant auth print-credentials --access-token", { encoding: "utf8" }).trim(),
      at: Date.now(),
    };
  }
  return cachedToken.value;
};
const anthropic = process.env.ANTHROPIC_API_KEY
  ? createAnthropic()
  : createAnthropic({ authToken: antToken, headers: { "anthropic-beta": "oauth-2025-04-20" } });
import { ToolLoopAgent } from "ai";
import { createDiskTools } from "@archildata/ai-sdk";

const DISK_NAME = process.env.DISK_NAME ?? "hack-workspace";
const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const task = process.argv.slice(2).join(" ") || "Write a haiku about storage and save it as haiku.txt";

archil.configure({
  apiKey: process.env.ARCHIL_API_KEY,
  region: process.env.ARCHIL_REGION ?? "aws-us-west-2",
});

// Reuse the disk if it exists, so the agent remembers earlier runs.
const [existing] = await archil.listDisks({ name: DISK_NAME });
const disk = existing ?? (await archil.createDisk({ name: DISK_NAME })).disk;

const workspace = archil.workspace({ workspace: { disk, conditional: true } });

const agent = new ToolLoopAgent({
  model: anthropic(MODEL),
  instructions: [
    "You work inside /mnt/archil/workspace. Use that path for bash and the file tools.",
    "Each bash command runs in a fresh microVM. Save anything you need later to the workspace.",
    "Read /mnt/archil/workspace/NOTES.md first if it exists, and append what you learned at the end.",
  ].join(" "),
  tools: createDiskTools(workspace),
});

const auditPath = `.audit/${Date.now()}.jsonl`;
const result = await agent.generate({
  prompt: task,
  onToolExecutionEnd: async ({ toolCall, toolExecutionMs }) => {
    const entry = { tool: toolCall.toolName, input: toolCall.input, ms: Math.round(toolExecutionMs) };
    console.log(`  tool ${entry.tool} (${entry.ms} ms)`);
    await disk.appendObject(auditPath, `${JSON.stringify(entry)}\n`);
  },
});

console.log("\n" + result.text);
console.log(`\nAudit log: ${auditPath} on disk ${DISK_NAME}`);
