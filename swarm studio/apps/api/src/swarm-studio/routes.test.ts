import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobPublisher } from "@swarm-studio/adapter-kit";
import { requestsSampleCheckout } from "@swarm-studio/contracts";
import type { PrismaClient } from "@swarm-studio/db";
import { afterEach, expect, it, vi } from "vitest";
import { swarmCompletionAnswer, swarmStudioRoutes } from "./routes.js";
import { screenFeed } from "./screen-feed.js";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("recognizes the bundled checkout and preserves an explicitly supplied app URL", () => {
  expect(requestsSampleCheckout("Test the sample checkout for duplicate payments")).toBe(true);
  expect(requestsSampleCheckout("Test the checkout demo at http://127.0.0.1:3000")).toBe(true);
  expect(requestsSampleCheckout("Test the sample checkout at https://qa.example.test")).toBe(false);
  expect(requestsSampleCheckout("Test checkout for duplicate payments")).toBe(false);
});

it("streams the newest available frame per worker and releases the subscription on disconnect", async () => {
  const connection = new AbortController();
  const unsubscribe = vi.fn();
  let publish!: (index: number, frame: Buffer) => void;
  const reader = screenFeed(connection.signal, (receive) => {
    publish = receive;
    return unsubscribe;
  }).getReader();
  publish(0, Buffer.from("older"));
  publish(0, Buffer.from("latest"));
  publish(1, Buffer.from("second worker"));
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toBe("retry: 750\n\n");
  expect(decoder.decode((await reader.read()).value)).toContain(
    Buffer.from("latest").toString("base64"),
  );
  expect(decoder.decode((await reader.read()).value)).toContain(
    Buffer.from("second worker").toString("base64"),
  );
  connection.abort();
  expect(await reader.read()).toMatchObject({ done: true });
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("delivers the measured checkout results even when worker notes omit them", () => {
  const answer = JSON.parse(
    swarmCompletionAnswer({
      id: "checkout-run",
      spec: {
        name: "QA",
        instructions: "Test checkout.",
        workers: 3,
        runtime: "sandbox",
        filesystem: "shared",
      },
      objective: "Find repeat charges.",
      at: 0,
      status: "done",
      demo: "checkout",
      workers: [
        { index: 0, role: "Desktop", status: "done", sampleEvidence: { payments: 1 } },
        { index: 1, role: "Mobile", status: "done", sampleEvidence: { payments: 0 } },
        {
          index: 2,
          role: "Stress",
          status: "done",
          result: "I inspected the checkout before writing the report.",
          sampleEvidence: { payments: 3, sessions: 3 },
          stress: { sessions: 3, passed: 3, writes: 3 },
        },
      ],
    }),
  );
  expect(answer.checkoutEvidence).toMatchObject({
    desktopPaymentCount: 1,
    invalidMobileEmailPaymentCount: 0,
    concurrentSessions: 3,
    concurrentPaymentCount: 3,
    duplicateChargesConfirmed: true,
  });
  expect(answer.workers[2].report).toContain("inspected the checkout");
});

it("isolates saved swarms by authenticated account and Space", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swarm-routes-"));
  temporary.push(directory);
  const origin = "http://127.0.0.1:5173";
  const routes = swarmStudioRoutes({
    directory,
    authenticate: async (request) => {
      const userId = request.headers.get("authorization");
      return userId
        ? { userId, spaceId: "space", email: "test@example.invalid", isDeploymentOwner: false }
        : null;
    },
    trustedOrigin: (input) => input === origin,
    prisma: {} as PrismaClient,
    events: { answerRunInput: vi.fn() },
    jobs: {} as JobPublisher,
  });
  expect((await routes.request("/state")).status).toBe(401);
  const spec = {
    name: "Release review",
    instructions: "Look for checkout errors.",
    workers: 2,
    runtime: "sandbox",
    filesystem: "private",
    browser: true,
  };
  const deploy = (origin: string) =>
    routes.request("/presets", {
      method: "POST",
      body: JSON.stringify(spec),
      headers: { "content-type": "application/json", origin, authorization: "alice" },
    });
  expect((await deploy("https://untrusted.invalid")).status).toBe(403);
  const created = await deploy(origin);
  expect(created.status).toBe(200);
  const { id } = await created.json();
  for (const user of ["alice", "bob"]) {
    const response = await routes.request("/state", { headers: { authorization: user } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { presets } = await response.json();
    expect(presets.some((item: { id: string }) => item.id === id)).toBe(user === "alice");
  }
  expect(
    (
      await routes.request(`/presets/${id}`, {
        method: "DELETE",
        headers: { origin, authorization: "bob" },
      })
    ).status,
  ).toBe(404);
});
