import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useQueryUserId } from "./query";
import { recheckSessionOnUnauthorized, selectedSpaceId, withSpaceHeaders } from "./rpc";
import { useBoundSpaceId } from "./space-rpc";

export type SwarmTemplate = "qa" | "fix" | "greenfield" | "gtm" | "custom";

export type SwarmSpec = {
  id?: string;
  presetId?: SwarmTemplate;
  name: string;
  instructions: string;
  workers: number;
  runtime: "sandbox" | "serverless";
  filesystem: "shared" | "private";
  search: boolean;
  browser: boolean;
  roles?: string[];
};

export type SwarmPreset = SwarmSpec & { id: string; summary?: string };

export type SwarmWorker = {
  index: number;
  role: string;
  status: "queued" | "starting" | "running" | "done" | "failed";
  activity?: string;
  browserUrl?: string;
  browserTitle?: string;
  screenRevision?: number;
  liveBrowser?: boolean;
  stress?: { sessions: number; passed: number; writes: number };
  sampleEvidence?: { payments?: number; sessions?: number };
  result?: string;
  sources?: { title?: string; url: string }[];
};

export type SwarmRun = {
  id: string;
  proposalId?: string;
  threadId?: string;
  objective: string;
  spec: SwarmSpec;
  demo?: "checkout";
  status: "running" | "done" | "failed";
  at: number;
  workers: SwarmWorker[];
  error?: string;
};

type SwarmState = {
  presets: SwarmPreset[];
  runs: SwarmRun[];
  configured: { archil: boolean; model: boolean; search: boolean };
};

export type SwarmDeployment = SwarmSpec & {
  objective: string;
  demo?: "checkout" | null;
  savePreset?: boolean;
  proposalId?: string;
  threadId?: string;
};

export const EMPTY_SWARM: SwarmSpec = {
  name: "",
  instructions: "",
  workers: 3,
  runtime: "sandbox",
  filesystem: "shared",
  search: false,
  browser: false,
};

const base = "/api/swarm-studio";

async function request<T>(spaceId: string | null, path: string, init?: RequestInit): Promise<T> {
  const headers = withSpaceHeaders(init?.headers, spaceId);
  if (init?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(base + path, { ...init, headers, credentials: "include" });
  recheckSessionOnUnauthorized(response.status);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Swarm Studio returned HTTP ${response.status}.`,
    );
  }
  return response.json() as Promise<T>;
}

export function useSwarmScope() {
  return { userId: useQueryUserId(), spaceId: useBoundSpaceId() ?? selectedSpaceId() };
}

type SwarmScope = ReturnType<typeof useSwarmScope>;

export function swarmStateKey({ userId, spaceId }: SwarmScope) {
  return ["swarm-studio", userId, spaceId, "state"] as const;
}

export function useSwarmState(scope: SwarmScope, watchRuns = false) {
  return useQuery({
    queryKey: swarmStateKey(scope),
    queryFn: ({ signal }) => request<SwarmState>(scope.spaceId, "/state", { signal }),
    refetchInterval: watchRuns
      ? (query) => (query.state.data?.runs.some((run) => run.status === "running") ? 1_500 : false)
      : false,
  });
}

export function useSwarmRun(
  { userId, spaceId }: SwarmScope,
  runId: string | undefined,
  watchScreens = false,
) {
  const interval = watchScreens ? 350 : 1_000;
  return useQuery({
    queryKey: ["swarm-studio", userId, spaceId, "runs", runId],
    enabled: Boolean(runId),
    queryFn: ({ signal }) =>
      request<{ run: SwarmRun }>(spaceId, `/runs/${encodeURIComponent(runId ?? "")}`, { signal }),
    select: (data) => data.run,
    refetchInterval: (query) =>
      !query.state.data || query.state.data.run.status === "running" ? interval : false,
    refetchIntervalInBackground: true,
  });
}

export function saveSwarmPreset(spaceId: string | null, spec: SwarmSpec) {
  return request<{ id: string }>(spaceId, "/presets", {
    method: "POST",
    body: JSON.stringify(spec),
  });
}

export function deleteSwarmPreset(spaceId: string | null, id: string) {
  return request<{ ok: true }>(spaceId, `/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function startSwarm(spaceId: string | null, spec: SwarmDeployment) {
  return request<{ runId: string }>(spaceId, "/runs", {
    method: "POST",
    body: JSON.stringify(spec),
  });
}

export function swarmScreenUrl(
  runId: string,
  index: number,
  revision: number,
  spaceId: string | null,
) {
  const query = new URLSearchParams({ revision: String(revision) });
  if (spaceId) query.set("spaceId", spaceId);
  return `${base}/runs/${encodeURIComponent(runId)}/screens/${index}?${query}`;
}

export function useSwarmScreenFrames(runId: string, spaceId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ runId: string; frames: Record<number, string> }>();
  useEffect(() => {
    if (!enabled) return;
    const query = new URLSearchParams();
    if (spaceId) query.set("spaceId", spaceId);
    const source = new EventSource(`${base}/runs/${encodeURIComponent(runId)}/screens?${query}`);
    const shown = new Map<number, number>();
    let sequence = 0;
    let open = true;
    source.onmessage = ({ data }) => {
      const [index, frame] = JSON.parse(data) as [number, string];
      const revision = ++sequence;
      const image = new Image();
      image.src = `data:image/png;base64,${frame}`;
      void image
        .decode()
        .then(() => {
          if (!open || revision <= (shown.get(index) ?? 0)) return;
          shown.set(index, revision);
          setState((previous) => ({
            runId,
            frames: {
              ...(previous?.runId === runId ? previous.frames : {}),
              [index]: image.src,
            },
          }));
        })
        .catch(() => {});
    };
    return () => {
      open = false;
      source.close();
    };
  }, [enabled, runId, spaceId]);
  return state?.runId === runId ? state.frames : undefined;
}

export function editablePreset(preset: SwarmPreset): SwarmSpec {
  const { id, ...spec } = preset;
  const builtIn = isSwarmTemplate(id);
  return {
    ...spec,
    browser: preset.browser ?? false,
    id: builtIn ? undefined : id,
    presetId: builtIn ? id : preset.presetId,
  };
}

export function isSwarmTemplate(id: string): id is SwarmTemplate {
  return ["qa", "fix", "greenfield", "gtm", "custom"].includes(id);
}
