import { runContinueJob } from "@swarm-studio/adapter-kit";
import type { JobPublisher } from "@swarm-studio/adapter-kit";
import { MessageBlock as MessageBlockSchema } from "@swarm-studio/contracts";
import type { Actor } from "@swarm-studio/contracts";
import { runAsTenant } from "@swarm-studio/db";
import type { PrismaClient, ThreadEvents } from "@swarm-studio/db";
import { getLogger } from "@swarm-studio/logging";
import { Hono } from "hono";
import { requestBodyLimit } from "../request-body-limit.js";
import { createSwarmRuns } from "./runtime/runs.mjs";
import type { SwarmRun, SwarmRunInput, SwarmSpecInput } from "./runtime/runs.mjs";
import { screenFeed } from "./screen-feed.js";

export function swarmCompletionAnswer(run: SwarmRun): string {
  const [desktop, mobile, repeatSubmit] = run.workers.map((worker) => worker.sampleEvidence);
  const checkoutEvidence =
    run.demo === "checkout"
      ? {
          source: "Payment history observed in the browsers during the initial checkout tests.",
          desktopPaymentCount: desktop?.payments,
          invalidMobileEmailPaymentCount: mobile?.payments,
          concurrentSessions: repeatSubmit?.sessions,
          concurrentPaymentCount: repeatSubmit?.payments,
          duplicateChargesConfirmed:
            repeatSubmit?.payments === undefined ? undefined : repeatSubmit.payments > 1,
          reproduction:
            "Submit the sample checkout concurrently from separate browser sessions, then inspect payment history.",
        }
      : undefined;
  return JSON.stringify({
    swarm: run.spec.name,
    runId: run.id,
    objective: run.objective,
    status: run.status,
    error: run.error,
    checkoutEvidence,
    workers: run.workers.map(({ role, status, result, stress }) => ({
      role,
      status,
      stress,
      report: result?.slice(0, 4_000),
    })),
  });
}

export function swarmStudioRoutes(options: {
  directory: string;
  authenticate(request: Request): Promise<Actor | null>;
  trustedOrigin(origin: string): boolean;
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "answerRunInput">;
  jobs: JobPublisher;
}) {
  const { authenticate, trustedOrigin, prisma, events, jobs } = options;
  const runs = createSwarmRuns({ directory: options.directory });
  const router = new Hono<{ Variables: { actor: Actor } }>();
  router.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    const request = c.req.raw;
    if (request.method !== "GET" && (!origin || !trustedOrigin(origin))) {
      return c.json({ error: "Untrusted request origin." }, 403);
    }
    const requestedSpace = c.req.query("spaceId");
    const screenRequest =
      request.method === "GET" && requestedSpace && /\/screens(?:\/|$)/.test(c.req.path);
    const headers = new Headers(request.headers);
    if (screenRequest && !headers.has("x-swarmstudio-space-id"))
      headers.set("x-swarmstudio-space-id", requestedSpace);
    const actor = await authenticate(screenRequest ? new Request(request, { headers }) : request);
    if (!actor) return c.json({ error: "Sign in to use Swarm Studio." }, 401);
    c.set("actor", actor);
    await runAsTenant(actor, next);
    c.header("cache-control", "no-store");
  });
  router.use("*", requestBodyLimit(24 * 1024));

  const settling = new Set<string>();
  async function settle(actor: Actor, run: SwarmRun, sourceRunId: string) {
    if (!run.proposalId || !run.threadId || settling.has(run.id)) return;
    settling.add(run.id);
    try {
      const accepted = await events.answerRunInput({
        spaceId: actor.spaceId,
        threadId: run.threadId,
        runId: sourceRunId,
        messageId: run.proposalId,
        answeredByUserId: actor.userId,
        answer: swarmCompletionAnswer(run),
      });
      if (accepted)
        await jobs.enqueue(runContinueJob(sourceRunId)).catch((error) => {
          getLogger().error("swarm completion enqueue", error);
        });
      runs.markSettled(actor, run.id);
    } catch (error) {
      // A subsequent visit retries delivering the durable result to chat.
      getLogger().error("swarm completion", error);
    } finally {
      settling.delete(run.id);
    }
  }
  function deliverResults(actor: Actor) {
    for (const { run, sourceRunId } of runs.pendingResults(actor))
      void settle(actor, run, sourceRunId);
  }

  router.get("/state", (c) => {
    deliverResults(c.var.actor);
    return c.json(runs.state(c.var.actor));
  });
  router.get("/runs/:id", (c) => {
    deliverResults(c.var.actor);
    const run = runs.get(c.var.actor, c.req.param("id"));
    return run ? c.json({ run }) : c.json({ error: "Swarm run not found." }, 404);
  });
  router.get("/runs/:id/screens", (c) => {
    const actor = c.var.actor;
    const id = c.req.param("id");
    if (!runs.get(actor, id)) return c.notFound();
    const body = screenFeed(c.req.raw.signal, (receive) =>
      runs.subscribeScreens(actor, id, receive),
    );
    return new Response(body, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" },
    });
  });
  router.get("/runs/:id/screens/:index", (c) => {
    const screen = runs.screen(c.var.actor, c.req.param("id"), c.req.param("index"));
    if (!screen) return c.notFound();
    return new Response(new Uint8Array(screen), { headers: { "content-type": "image/png" } });
  });
  router.post("/presets", async (c) => {
    try {
      const input = await c.req.json<SwarmSpecInput>();
      return c.json({ id: runs.savePreset(c.var.actor, input) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid swarm." }, 400);
    }
  });
  router.delete("/presets/:id", (c) =>
    runs.deletePreset(c.var.actor, c.req.param("id"))
      ? c.json({ ok: true })
      : c.json({ error: "Saved swarm not found." }, 404),
  );
  router.post("/runs", async (c) => {
    const actor = c.var.actor;
    try {
      const input = await c.req.json<SwarmRunInput>();
      let proposal: { messageId: string; threadId: string; sourceRunId: string } | undefined;
      if (input.proposalId) {
        const existing = runs.findProposal(actor, input.proposalId);
        if (existing) return c.json({ runId: existing });
        const message = await prisma.message.findFirst({
          where: {
            id: input.proposalId,
            role: "bot",
            thread: { spaceId: actor.spaceId },
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
          select: { threadId: true, runId: true, blocks: true },
        });
        const source =
          message?.runId &&
          (await prisma.run.findFirst({
            where: {
              id: message.runId,
              spaceId: actor.spaceId,
              threadId: message.threadId,
              userId: actor.userId,
              status: "waiting_input",
            },
            select: { id: true },
          }));
        const blocks = MessageBlockSchema.array().safeParse(message?.blocks);
        if (
          !message ||
          !source ||
          !blocks.success ||
          !blocks.data.some(
            (block) =>
              block.kind === "ask" &&
              block.status !== "answered" &&
              "swarm" in block &&
              block.swarm,
          )
        ) {
          return c.json({ error: "This swarm proposal is no longer awaiting a decision." }, 409);
        }
        proposal = {
          messageId: input.proposalId,
          threadId: message.threadId,
          sourceRunId: source.id,
        };
      }
      const runId = runs.start(
        actor,
        {
          ...input,
          proposalId: proposal?.messageId,
          threadId: proposal?.threadId,
          sourceRunId: proposal?.sourceRunId,
        },
        async (run) => {
          if (proposal) await settle(actor, run, proposal.sourceRunId);
        },
      );
      return c.json({ runId }, 202);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Could not start the swarm." },
        400,
      );
    }
  });
  return router;
}
