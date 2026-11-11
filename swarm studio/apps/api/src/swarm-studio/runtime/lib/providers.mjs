const clineBaseUrl = "https://api.cline.bot/api/v1";

export function providerConfig(env = process.env) {
  return {
    model: env.MODEL_ID,
    modelKey: env.MODEL_API_KEY || env.CLINE_API_KEY,
    modelUrl: (env.MODEL_BASE_URL || clineBaseUrl).replace(/\/+$/, ""),
    archilKey: env.ARCHIL_API_KEY,
    archilRegion: env.ARCHIL_REGION || "aws-us-west-2",
    keenableKey: env.KEENABLE_API_KEY,
  };
}

export function createProviders(config = providerConfig(), request = fetch) {
  let archilPromise;
  return {
    config,
    configure(next) {
      if (next.archilKey !== config.archilKey || next.archilRegion !== config.archilRegion) {
        archilPromise = undefined;
      }
      Object.assign(config, next);
    },
    async complete(messages, tools) {
      if (!config.model || !config.modelKey) {
        throw new Error("Set MODEL_ID and CLINE_API_KEY or MODEL_API_KEY in .env to use chat.");
      }
      const result = await request(`${config.modelUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.modelKey}` },
        body: JSON.stringify({ model: config.model, messages, tools }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!result.ok) throw new Error(`Model provider returned HTTP ${result.status}. Check the key and model ID.`);
      const body = await result.json();
      const message = (body.choices ?? body.data?.choices)?.[0]?.message;
      if (!message) throw new Error("The model provider returned no message.");
      return { ...message, role: "assistant" };
    },
    async search(query) {
      if (!config.keenableKey) throw new Error("Set KEENABLE_API_KEY to use web search.");
      const result = await request("https://api.keenable.ai/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": config.keenableKey },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!result.ok) throw new Error(`Keenable returned HTTP ${result.status}.`);
      const { results } = await result.json();
      if (!Array.isArray(results)) throw new Error("Keenable returned an unexpected response.");
      return JSON.stringify(results.slice(0, 6).map(({ title, url, snippet, description }) => ({
        title, url, excerpt: String(snippet || description || "").slice(0, 1_800),
      })));
    },
    archil() {
      if (!config.archilKey) throw new Error("Set ARCHIL_API_KEY in .env to deploy a swarm.");
      archilPromise ??= import("disk").then(({ Archil }) => new Archil({
        apiKey: config.archilKey, region: config.archilRegion,
      }));
      return archilPromise;
    },
  };
}
