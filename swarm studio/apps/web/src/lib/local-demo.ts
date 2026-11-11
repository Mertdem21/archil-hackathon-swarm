export const localDemo = import.meta.env.SWARM_STUDIO_LOCAL_DEMO === "true";

let opening: Promise<void> | undefined;

export function openLocalSession(): Promise<void> {
  opening ??= fetch("/api/auth/local-session", { method: "POST", credentials: "same-origin" })
    .then(async (response) => {
      if (response.ok) return;
      const body = await response.json().catch(() => undefined);
      throw new Error(body?.error || "Could not open the local session.");
    })
    .finally(() => {
      opening = undefined;
    });
  return opening;
}
