import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requestsSampleCheckout } from "@swarm-studio/contracts";
import { normalizeSpec, presets } from "./lib/presets.mjs";
import { createProviders, providerConfig } from "./lib/providers.mjs";
import { runSwarm } from "./lib/swarm.mjs";

function readJSON(filename, fallback) {
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function createSwarmRuns({ directory, providers = createProviders(providerConfig()) }) {
  const active = new Map();
  const scope = ({ spaceId, userId }) => {
    const id = createHash("sha256")
      .update(JSON.stringify([spaceId, userId]))
      .digest("hex");
    return join(directory, id);
  };

  function owner(actor) {
    const dir = scope(actor);
    let entry = active.get(dir);
    if (entry) return entry;
    const file = join(dir, "state.json");
    const data = readJSON(file, { presets: [], runs: [], workspaces: {} });
    const save = () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
      renameSync(file + ".tmp", file);
    };
    let recovered = false;
    for (const run of data.runs) {
      if (run.status !== "running") continue;
      recovered = true;
      run.status = "failed";
      run.error = "Swarm Studio restarted before this run finished.";
      for (const worker of run.workers) {
        if (worker.status === "done" || worker.status === "failed") continue;
        worker.status = "failed";
        worker.activity = "";
        worker.result = run.error;
      }
    }
    if (recovered) save();
    entry = { dir, data, save, viewers: new Map() };
    active.set(dir, entry);
    return entry;
  }

  function savePreset(entry, input) {
    const spec = normalizeSpec(input);
    const id = input.id ?? randomUUID();
    const index = entry.data.presets.findIndex((preset) => preset.id === id);
    if (input.id && index < 0) throw new Error("Saved swarm not found.");
    const preset = { ...spec, id };
    if (index < 0) entry.data.presets.push(preset);
    else entry.data.presets[index] = preset;
    entry.save();
    return id;
  }

  const frameFile = (entry, id, index) => join(entry.dir, `${id}-${index}.png`);
  function readScreen(entry, id, index) {
    try {
      return readFileSync(frameFile(entry, id, index));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  const publicRun = ({ sourceRunId, settled, diskId, workers, ...run }) => ({
    ...run,
    workers: workers.map(({ sandboxId, diskId: workerDisk, cleanupError, ...worker }) => worker),
  });

  return {
    state(actor) {
      const { data } = owner(actor);
      const { archilKey, model, modelKey, keenableKey } = providers.config;
      return {
        presets: [...presets, ...data.presets],
        runs: data.runs.map(publicRun),
        configured: {
          archil: Boolean(archilKey),
          model: Boolean(model && modelKey),
          search: Boolean(keenableKey),
        },
      };
    },
    get(actor, id) {
      const run = owner(actor).data.runs.find((entry) => entry.id === id);
      return run && publicRun(run);
    },
    findProposal(actor, proposalId) {
      const run = owner(actor).data.runs.find((entry) => entry.proposalId === proposalId);
      return run?.id;
    },
    pendingResults(actor) {
      return owner(actor).data.runs.flatMap((run) =>
        run.status !== "running" && run.sourceRunId && !run.settled
          ? [{ run: publicRun(run), sourceRunId: run.sourceRunId }]
          : [],
      );
    },
    markSettled(actor, id) {
      const entry = owner(actor);
      const run = entry.data.runs.find((run) => run.id === id);
      if (run && !run.settled) {
        run.settled = true;
        entry.save();
      }
    },
    savePreset(actor, input) {
      return savePreset(owner(actor), input);
    },
    deletePreset(actor, id) {
      const entry = owner(actor);
      const index = entry.data.presets.findIndex((preset) => preset.id === id);
      if (index < 0) return false;
      entry.data.presets.splice(index, 1);
      entry.save();
      return true;
    },
    screen(actor, id, index) {
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-5]$/.test(index)) return undefined;
      return readScreen(owner(actor), id, index);
    },
    subscribeScreens(actor, id, receive) {
      const entry = owner(actor);
      const run = entry.data.runs.find((run) => run.id === id);
      if (!run) return () => {};
      for (const { index } of run.workers) {
        const frame = readScreen(entry, id, index);
        if (frame) receive(index, frame);
      }
      const viewers = entry.viewers.get(id) ?? new Set();
      entry.viewers.set(id, viewers);
      viewers.add(receive);
      return () => {
        viewers.delete(receive);
        if (!viewers.size) entry.viewers.delete(id);
      };
    },
    start(actor, input, onDone) {
      const entry = owner(actor);
      const existing =
        input.proposalId && entry.data.runs.find((run) => run.proposalId === input.proposalId);
      if (existing) return existing.id;
      const spec = normalizeSpec(input);
      const objective = typeof input.objective === "string" ? input.objective.trim() : "";
      const sampleRequested =
        input.demo === "checkout" ||
        (input.demo === undefined &&
          spec.browser &&
          spec.runtime === "sandbox" &&
          requestsSampleCheckout(objective));
      const demo = sampleRequested ? "checkout" : undefined;
      if (!objective || objective.length > 8_000)
        throw new Error("Enter a task under 8,000 characters.");
      if (demo && (!spec.browser || spec.runtime !== "sandbox"))
        throw new Error("The sample checkout requires browser sandboxes.");
      if (!providers.config.archilKey) throw new Error("An Archil connection is required.");
      if (!providers.config.modelKey || !providers.config.model)
        throw new Error("A swarm model connection is required.");
      if (spec.search && !providers.config.keenableKey)
        throw new Error("Connect Keenable or turn off web search.");
      if (input.savePreset) savePreset(entry, { ...input, id: undefined });
      const id = randomUUID();
      const run = {
        id,
        objective,
        spec,
        demo,
        status: "running",
        at: Date.now(),
        proposalId: input.proposalId,
        sourceRunId: input.sourceRunId,
        threadId: input.threadId,
        workers: Array.from({ length: spec.workers }, (_, index) => ({
          index,
          role: spec.roles[index] || `Independent investigation ${index + 1}`,
          status: "queued",
        })),
      };
      const workspaceId = input.threadId || id;
      const chat = (entry.data.workspaces[workspaceId] ??= { id: workspaceId });
      entry.data.runs.unshift(run);
      entry.save();
      void runSwarm({
        run,
        chat,
        providers,
        update: entry.save,
        publishScreen(_id, index, frame) {
          const file = frameFile(entry, id, index);
          writeFileSync(file + ".tmp", frame, { mode: 0o600 });
          renameSync(file + ".tmp", file);
          for (const receive of entry.viewers.get(id) ?? []) receive(index, frame);
        },
      })
        .then(() => onDone?.(publicRun(run)))
        .catch((error) => {
          console.error(
            "Swarm run completion failed:",
            error instanceof Error ? error.name : "UnknownError",
          );
        });
      return id;
    },
  };
}
