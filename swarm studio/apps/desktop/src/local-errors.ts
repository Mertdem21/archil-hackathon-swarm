import type { ClientOperation } from "@swarm-studio/logging/monitoring";
import { sanitizedError } from "@swarm-studio/logging/monitoring";

export function reportDesktopError(
  error: unknown,
  operation: ClientOperation,
  tags?: Record<string, string>,
): void {
  console.error(operation, sanitizedError(error), tags);
}

export function installDesktopEarlyErrorLogging(): void {
  process.on("uncaughtExceptionMonitor", (error) => {
    reportDesktopError(error, "desktop.startup");
  });
  // A launcher that closed its end of stdout or stderr must not turn a log into a crash.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (stream === process.stdout && error.code !== "EPIPE") reportDesktopError(error, "desktop.startup");
    });
  }
}
