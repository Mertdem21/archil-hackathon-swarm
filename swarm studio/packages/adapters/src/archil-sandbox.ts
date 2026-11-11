import type { ComputerRef } from "@swarm-studio/adapter-kit";
import type { Archil, CreatedSandboxPortToken, Sandbox } from "disk";
import { shellQuote } from "./computer-support.js";
import type { CommandStartOpts, RemoteDesktop, RemoteDesktopSdk } from "./remote-desktop-sandbox.js";
import { RemoteDesktopSandboxProvider } from "./remote-desktop-sandbox.js";
import { sandboxNotFoundError } from "./sandbox-errors.js";

const PORT_TOKEN_TTL = "30m";

type ArchilOptions = {
  apiKey: string;
  region?: string;
  image: string;
  sharedDiskId?: string;
};

/** The filesystem API is used for byte transfers. Stat and list use POSIX on the same guest. */
const FILE_METADATA = `
import json, os, stat, sys
def entry(path):
    info = os.lstat(path)
    kind = "dir" if stat.S_ISDIR(info.st_mode) else "file" if stat.S_ISREG(info.st_mode) else "other"
    return dict(name=os.path.basename(path), type=kind, size=info.st_size, mode=info.st_mode)
path = sys.argv[2]
print(json.dumps([entry(os.path.join(path, name)) for name in os.listdir(path)]
                 if sys.argv[1] == "list" else entry(path)))
`;

function seconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000));
}

function status(error: unknown): unknown {
  return error instanceof Error && "status" in error ? error.status : undefined;
}

async function run(sandbox: Sandbox, command: string, options: CommandStartOpts = {}) {
  options.signal?.throwIfAborted();
  const process = await sandbox.run(command, {
    cwd: options.cwd,
    env: options.envs,
    timeoutSeconds: options.timeoutMs === undefined ? undefined : seconds(options.timeoutMs),
  });
  const abort = () => {
    void process.kill().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const result = await process.wait();
    options.signal?.throwIfAborted();
    return {
      exitCode: result.exitCode ?? (result.status === "completed" ? 0 : 1),
      stdout: result.stdout,
      stderr: result.stderr || result.exitReason || "",
    };
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

function desktopFor(sandbox: Sandbox): RemoteDesktop {
  const portTokens = new Map<number, { access: Promise<CreatedSandboxPortToken>; renewAt: number }>();
  async function metadata(mode: "list" | "stat", path: string, signal?: AbortSignal) {
    const result = await run(
      sandbox,
      `python3 -c ${shellQuote(FILE_METADATA)} ${mode} ${shellQuote(path)}`,
      { signal },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || "Could not read file metadata");
    return JSON.parse(result.stdout);
  }
  return {
    sandboxId: sandbox.id,
    setTimeout: async (timeoutMs) => {
      await sandbox.setTimeout({ idleTtlSeconds: seconds(timeoutMs) });
    },
    async getPortAccess(port) {
      let entry = portTokens.get(port);
      if (!entry || entry.renewAt <= Date.now()) {
        entry = {
          access: sandbox.createPortToken(port, { ttl: PORT_TOKEN_TTL }),
          renewAt: Date.now() + 25 * 60_000,
        };
        portTokens.set(port, entry);
      }
      const access = await entry.access.catch((error: unknown) => {
        if (portTokens.get(port) === entry) portTokens.delete(port);
        throw error;
      });
      return { hostname: access.hostname, headers: { "X-Archil-Token": access.token } };
    },
    commands: { run: (command, options) => run(sandbox, command, options) },
    files: {
      async makeDir(path) {
        const result = await run(sandbox, `mkdir -p -- ${shellQuote(path)}`);
        if (result.exitCode !== 0) throw new Error(result.stderr || "Could not create directory");
        return true;
      },
      list: (path, options) => metadata("list", path, options.signal),
      getInfo: (path, options) => metadata("stat", path, options.signal),
      async read(path, options) {
        options.signal?.throwIfAborted();
        const chunks: Buffer[] = [];
        await sandbox.files.downloadFile(path, (chunk) => {
          options.signal?.throwIfAborted();
          chunks.push(Buffer.from(chunk));
        });
        return Buffer.concat(chunks);
      },
      async write(files, options) {
        for (const file of files) {
          options.signal?.throwIfAborted();
          await sandbox.files.uploadFile(file.data, file.path);
        }
      },
    },
  };
}

function archilSdk(client: Archil, sharedDiskId?: string): RemoteDesktopSdk {
  const lookup = async (id: string) => {
    try {
      return await client.sandboxes.get(id);
    } catch (error) {
      if (status(error) === 404) {
        throw sandboxNotFoundError(`Archil sandbox ${id} not found`, { cause: error });
      }
      throw error;
    }
  };
  return {
    async create(image, options) {
      return desktopFor(
        await client.sandboxes.create({
          baseImage: image,
          vcpuCount: 2,
          memSizeMiB: 4096,
          idleTtlSeconds: seconds(options.timeoutMs),
          ...(sharedDiskId
            ? { mounts: [{ disk: sharedDiskId, path: "/mnt/archil", conditional: true }] }
            : {}),
        }),
      );
    },
    async connect(id) {
      const sandbox = await lookup(id);
      if (sandbox.status === "paused") await sandbox.resume();
      else if (sandbox.status !== "running") await sandbox.start();
      return desktopFor(sandbox);
    },
    async connectRunning(id) {
      const sandbox = await lookup(id);
      if (sandbox.status !== "running") throw new Error("Archil sandbox is stopped");
      return desktopFor(sandbox);
    },
    async isRunning(id) {
      return (await lookup(id)).status === "running";
    },
    async pause(id) {
      const sandbox = await lookup(id);
      if (sandbox.status !== "stopped") await sandbox.stop();
    },
    async kill(id) {
      try {
        const sandbox = await lookup(id);
        if (sandbox.status === "running" || sandbox.status === "paused") await sandbox.stop();
        await sandbox.delete();
        return true;
      } catch (error) {
        if (status(error) === 404 || (error instanceof Error && error.name === "SandboxNotFoundError")) {
          return false;
        }
        throw error;
      }
    },
  };
}

export async function createArchilSandboxProvider(options: ArchilOptions) {
  const { Archil } = await import("disk");
  const client = new Archil({ apiKey: options.apiKey, region: options.region });
  return new ArchilSandboxProvider(options, archilSdk(client, options.sharedDiskId));
}

class ArchilSandboxProvider extends RemoteDesktopSandboxProvider {
  constructor(options: ArchilOptions, sdk: RemoteDesktopSdk) {
    super({
      id: "archil",
      label: "Archil",
      apiKey: options.apiKey,
      sdk,
      template: options.image,
      isTimeoutError: () => false,
    });
  }

  async keepsHome(_computer: ComputerRef) {
    return true;
  }
}
