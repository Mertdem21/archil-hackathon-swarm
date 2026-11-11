import { createHmac } from "node:crypto";
import type { Auth } from "@swarm-studio/auth";
import type { PrismaClient } from "@swarm-studio/db";
import type { Hono } from "hono";

const localEmail = "local@swarm-studio.test";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function mountLocalSwarmSession(
  app: Hono,
  options: {
    auth: Auth;
    prisma: PrismaClient;
    authSecret: string;
    webOrigin: string;
    apiHost: string;
  },
) {
  const { auth, prisma, authSecret, webOrigin, apiHost } = options;
  if (
    process.env.SWARM_STUDIO_LOCAL_DEMO !== "true" ||
    !loopbackHosts.has(apiHost) ||
    !loopbackHosts.has(new URL(webOrigin).hostname)
  ) {
    return;
  }

  const password = createHmac("sha256", authSecret)
    .update("swarm-studio-local-session")
    .digest("hex");
  const headers = { "content-type": "application/json", origin: webOrigin };
  const credentials = { email: localEmail, password };
  function authRequest(path: "sign-in" | "sign-up", body: object) {
    return auth.handler(
      new Request(new URL(`/api/auth/${path}/email`, webOrigin), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }

  let account: Promise<void> | undefined;
  async function ensureAccount() {
    const existing = await prisma.user.findUnique({
      where: { email: localEmail },
      select: { id: true },
    });
    if (existing) return;
    const response = await authRequest("sign-up", { ...credentials, name: "Local" });
    if (!response.ok) throw new Error("Could not initialize the local account.");
  }

  app.post("/api/auth/local-session", async (c) => {
    c.header("cache-control", "no-store");
    if (c.req.header("origin") !== webOrigin) return c.json({ error: "Untrusted origin." }, 403);
    try {
      account ??= ensureAccount().catch((error) => {
        account = undefined;
        throw error;
      });
      await account;
      const signedIn = await authRequest("sign-in", credentials);
      const cookies = signedIn.headers.getSetCookie();
      if (!signedIn.ok || !cookies.length) {
        return c.json({ error: "Could not start the local session." }, 503);
      }

      const apiKey = process.env.MODEL_API_KEY || process.env.CLINE_API_KEY;
      const baseUrl = process.env.MODEL_BASE_URL;
      const modelId = process.env.MODEL_ID;
      if (apiKey && baseUrl && modelId) {
        const connected = await app.request(new URL("/rpc/models/connect", webOrigin), {
          method: "POST",
          headers: { ...headers, cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; ") },
          body: JSON.stringify({
            json: {
              provider: "openai-compatible",
              apiProtocol: "chat-completions",
              label: "Local model",
              baseUrl,
              apiKey,
              modelId,
              contextWindow: 131_072,
              maxTokens: 8_192,
            },
          }),
        });
        if (!connected.ok) return c.json({ error: "Could not connect the local model." }, 503);
      }

      for (const cookie of cookies) c.header("set-cookie", cookie, { append: true });
      return c.body(null, 204);
    } catch {
      return c.json({ error: "Could not initialize the local session." }, 503);
    }
  });
}
