import type { RealtimeFanout, SecretStore } from "@swarm-studio/adapter-kit";
import { createSecretStore } from "@swarm-studio/adapters";
import { resolveEncryptionKey } from "@swarm-studio/core";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
