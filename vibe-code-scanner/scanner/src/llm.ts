// Host-side Claude access. The API key never enters a sandbox.
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { execSync } from "node:child_process";

let cached = { value: "", at: 0 };
const antToken = () => {
  if (Date.now() - cached.at > 5 * 60_000) {
    cached = { value: execSync("ant auth print-credentials --access-token", { encoding: "utf8" }).trim(), at: Date.now() };
  }
  return cached.value;
};
export const anthropic = process.env.ANTHROPIC_API_KEY
  ? createAnthropic()
  : createAnthropic({ authToken: antToken, headers: { "anthropic-beta": "oauth-2025-04-20" } });

export const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";

/** One prompt in, text out. Aborts after timeoutMs (default 110 s, under the 2-minute checker limit). */
export async function ask(system: string, prompt: string, timeoutMs = 110_000): Promise<string> {
  const { text } = await generateText({
    model: anthropic(MODEL),
    system,
    prompt,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return text;
}

/** Pull the first JSON array out of a model reply. Returns [] if none parses. */
export function parseJsonArray<T>(text: string): T[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1)) as T[];
  } catch {
    return [];
  }
}
