import type { Actor } from "@swarm-studio/contracts";

export type SwarmSpecInput = {
  id?: string;
  presetId?: string;
  name: string;
  instructions: string;
  workers: number;
  runtime: "sandbox" | "serverless";
  filesystem: "shared" | "private";
  search?: boolean;
  browser?: boolean;
  roles?: string[];
};

export type SwarmRunInput = SwarmSpecInput & {
  objective: string;
  demo?: "checkout" | null;
  savePreset?: boolean;
  proposalId?: string;
  sourceRunId?: string;
  threadId?: string;
};

type WorkerStatus = "queued" | "starting" | "running" | "done" | "failed";
export type SwarmRun = {
  id: string;
  spec: SwarmSpecInput;
  objective: string;
  at: number;
  status: "running" | "done" | "failed";
  demo?: "checkout";
  error?: string;
  threadId?: string;
  proposalId?: string;
  workers: {
    index: number;
    role: string;
    status: WorkerStatus;
    result?: string;
    sampleEvidence?: { payments?: number; sessions?: number };
    stress?: { sessions: number; passed: number; writes: number };
  }[];
};

export function createSwarmRuns(input: { directory: string }): {
  state(actor: Actor): {
    presets: SwarmSpecInput[];
    runs: SwarmRun[];
    configured: { archil: boolean; model: boolean; search: boolean };
  };
  get(actor: Actor, id: string): SwarmRun | undefined;
  findProposal(actor: Actor, proposalId: string): string | undefined;
  pendingResults(actor: Actor): { run: SwarmRun; sourceRunId: string }[];
  markSettled(actor: Actor, id: string): void;
  savePreset(actor: Actor, input: SwarmSpecInput): string;
  deletePreset(actor: Actor, id: string): boolean;
  screen(actor: Actor, id: string, index: string): Buffer | undefined;
  subscribeScreens(
    actor: Actor,
    id: string,
    receive: (index: number, frame: Buffer) => void,
  ): () => void;
  start(actor: Actor, input: SwarmRunInput, onDone?: (run: SwarmRun) => Promise<void>): string;
};
