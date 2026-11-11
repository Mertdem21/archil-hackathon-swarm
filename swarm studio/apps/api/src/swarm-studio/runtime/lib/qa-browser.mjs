import { readFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

export const playwrightVersion = "1.64.1";
const directory = "/tmp/swarm-qa";
const maxLineSize = 2_100_000;

export async function readSwarmAsset(path) {
  return readFile(new URL(`../${path}`, import.meta.url)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return readFile(new URL(`./swarm-assets/${path}`, import.meta.url));
  });
}

export async function startQaBrowser(sandbox, { mobile, onFrame }) {
  const install = await sandbox.exec(
    `mkdir -p ${directory} && npm install --prefix ${directory} --no-save --no-audit --no-fund playwright-core@${playwrightVersion}`,
    { timeoutSeconds: 90 },
  );
  if (install.exitCode !== 0) throw new Error("Could not install the QA browser driver.");
  await sandbox.files.uploadFile(await readSwarmAsset("qa/browser.mjs"), `${directory}/browser.mjs`);
  return connectQaBrowser(sandbox, { command: `node ${directory}/browser.mjs${mobile ? " --mobile" : ""}`, onFrame });
}

export async function connectQaBrowser(sandbox, { command, onFrame }) {
  const decoder = new StringDecoder("utf8");
  let lineBuffer = "";
  let stderr = "";
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const ready = Promise.withResolvers();
  // The process can exit before the startup await attaches its handler.
  void ready.promise.catch(() => {});

  function receive(event) {
    if (event.type === "ready") ready.resolve();
    else if (event.type === "frame" && typeof event.image === "string") {
      onFrame(Buffer.from(event.image, "base64"));
    } else if (event.type === "result") {
      const call = pending.get(event.id);
      if (!call) return;
      if (event.error) call.reject(new Error(event.error));
      else call.resolve(event.result);
    }
  }

  function onOutput({ stream, data }) {
    if (stream === "stderr") {
      stderr = (stderr + Buffer.from(data).toString("utf8")).slice(-500);
      return;
    }
    lineBuffer += decoder.write(Buffer.from(data));
    let newline;
    while ((newline = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(newline + 1);
      if (line.length > maxLineSize) continue;
      try { receive(JSON.parse(line)); }
      catch { /* A malformed frame cannot interrupt other workers or the browser transport. */ }
    }
    if (lineBuffer.length > maxLineSize) lineBuffer = "";
  }

  const process = await sandbox.run(command, { onOutput, collectOutput: false });
  const markClosed = (error) => {
    closed = true;
    ready.reject(error);
    for (const call of pending.values()) call.reject(error);
  };
  void process.wait().then(
    () => markClosed(new Error(`QA browser closed${stderr ? `: ${stderr.trim()}` : "."}`)),
    () => markClosed(new Error("The connection to the QA browser ended.")),
  );
  const startupTimeout = setTimeout(() => ready.reject(new Error("QA browser did not start in time.")), 25_000);
  try { await ready.promise; }
  catch (error) {
    await process.closeStdin().catch(() => {});
    throw error;
  } finally { clearTimeout(startupTimeout); }

  return {
    async step(args) {
      if (closed) throw new Error("QA browser is closed.");
      const id = ++sequence;
      const call = Promise.withResolvers();
      void call.promise.catch(() => {});
      pending.set(id, call);
      const timeout = setTimeout(() => call.reject(new Error("The browser action timed out.")), 35_000);
      try {
        await process.sendInput(JSON.stringify({ ...args, id }) + "\n");
        return await call.promise;
      } finally {
        clearTimeout(timeout);
        pending.delete(id);
      }
    },
    async close() {
      if (!closed) await process.closeStdin().catch(() => {});
    },
  };
}
