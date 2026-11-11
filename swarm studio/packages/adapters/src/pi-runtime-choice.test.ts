import type { AgentRuntimeEvent, ConnectorTool } from "@swarm-studio/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeAgentState = vi.hoisted(() => ({
  options: ["Berlin", "Seoul", "Toronto"],
  detail: undefined as string | undefined,
  swarm: undefined as Record<string, unknown> | undefined,
  tools: [] as Array<{
    name: string;
    prepareArguments?: (args: unknown) => Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }>,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: undefined, messages: [] };
    private readonly tools: typeof fakeAgentState.tools;

    constructor(options: { initialState: { tools: typeof fakeAgentState.tools } }) {
      this.tools = options.initialState.tools;
      fakeAgentState.tools = this.tools;
    }

    subscribe(_listener: unknown) {}

    async prompt() {
      if (fakeAgentState.swarm) {
        const tool = this.tools.find(({ name }) => name === "deploy_swarm");
        if (!tool) throw new Error("deploy_swarm tool missing");
        const args = tool.prepareArguments?.(fakeAgentState.swarm) ?? fakeAgentState.swarm;
        await tool.execute("call-swarm-1", args);
        return;
      }
      const askUser = this.tools.find((tool) => tool.name === "ask_user");
      if (!askUser) throw new Error("ask_user tool missing");
      // The real agent prepares the model's arguments before executing them.
      const raw = {
        question: "Which city should I use?",
        options: fakeAgentState.options,
        ...(fakeAgentState.detail === undefined ? {} : { detail: fakeAgentState.detail }),
      };
      const args = askUser.prepareArguments?.(raw) ?? raw;
      await askUser.execute("call-choice-1", args);
    }

    async waitForIdle() {}

    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (_provider: string, modelId: string) =>
      modelId === "choice-pi-model" ? { provider: "test", id: modelId } : undefined,
    streamSimple: () => {
      throw new Error("the fake agent must not call a provider");
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { builtinAgentTools } from "./builtin-tools.js";
import { PiAgentRuntime } from "./pi-runtime.js";

const choiceTool: ConnectorTool = {
  name: "ask_user",
  description: "Ask a short multiple-choice question",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array", items: { type: "string" } },
    },
    required: ["question", "options"],
  },
};

const runContext = {
  operationId: "choice-pi",
  traceId: "choice-pi",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

const runRequest = {
  botId: "bot",
  threadId: "thread",
  runId: "run",
  prompt: "ask me which city to use",
  instructions: "Use ask_user for a short list of options.",
  history: [],
  tools: [choiceTool],
  model: { provider: "test", id: "choice-pi-model" },
};

describe("Pi choice asks", () => {
  beforeEach(() => {
    fakeAgentState.tools = [];
    fakeAgentState.options = ["Berlin", "Seoul", "Toronto"];
    fakeAgentState.detail = undefined;
    fakeAgentState.swarm = undefined;
  });

  it("emits a tappable ask and stops without a finished-work fallback", async () => {
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.run(runRequest, runContext)) events.push(event);

    expect(events).toContainEqual({
      type: "ask",
      text: "Which city should I use?",
      actions: [
        { id: "choice-1", label: "Berlin" },
        { id: "choice-2", label: "Seoul" },
        { id: "choice-3", label: "Toronto" },
      ],
    });
    expect(
      events.some((event) => event.type === "text" && event.text.includes("I finished the work.")),
    ).toBe(false);
  });

  it("carries the content the user is deciding on as the ask's detail", async () => {
    fakeAgentState.detail = "To: person@example.test\nSubject: Hello\n\nThe draft body.";
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];

    for await (const event of runtime.run(runRequest, runContext)) events.push(event);

    expect(events).toContainEqual({
      type: "ask",
      text: "Which city should I use?",
      detail: "To: person@example.test\nSubject: Hello\n\nThe draft body.",
      actions: [
        { id: "choice-1", label: "Berlin" },
        { id: "choice-2", label: "Seoul" },
        { id: "choice-3", label: "Toronto" },
      ],
    });
  });

  it("pauses for a swarm choice without executing any worker", async () => {
    fakeAgentState.swarm = {
      objective: "Test the checkout with sk-test-secret",
      preset: "qa",
    };
    const tool = builtinAgentTools.find(({ name }) => name === "deploy_swarm");
    if (!tool) throw new Error("deploy_swarm tool missing");
    const executeTool = vi.fn();
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.run(
      { ...runRequest, tools: [tool], executeTool, secrets: ["sk-test-secret"] },
      runContext,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "ask",
      text: "Deploy a swarm?",
      detail: "Test the checkout with [redacted]",
      swarm: { objective: "Test the checkout with [redacted]", preset: "qa" },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("rejects an empty choice set before emitting an ask", async () => {
    fakeAgentState.options = [];
    const runtime = new PiAgentRuntime();
    const events: AgentRuntimeEvent[] = [];

    await expect(async () => {
      for await (const event of runtime.run(runRequest, runContext)) events.push(event);
    }).rejects.toThrow("ask_user requires two to four unique, non-empty options");
    expect(events.some((event) => event.type === "ask")).toBe(false);
  });
});
