import type { ClientOperation } from "@swarm-studio/logging/monitoring";
import { sanitizedError } from "@swarm-studio/logging/monitoring";

export function reportMobileError(
  error: unknown,
  operation: ClientOperation,
  tags?: Record<string, string>,
): void {
  console.error(operation, sanitizedError(error), tags);
}
