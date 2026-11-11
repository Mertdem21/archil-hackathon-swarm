export function requestsSampleCheckout(objective: string): boolean {
  if (
    !/\b(?:sample[\s-]+checkout|checkout[\s-]+(?:demo|sample)|demo[\s-]+checkout)\b/i.test(
      objective,
    )
  ) {
    return false;
  }
  // The bundled fixture owns port 3000 inside its sandbox. Other URLs identify a real target.
  return [...objective.matchAll(/https?:\/\/[^\s<>"')\]}]+/gi)].every(([target]) => {
    try {
      const url = new URL(target);
      return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "3000";
    } catch {
      return false;
    }
  });
}
