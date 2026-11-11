import type { SpanAttributes, TelemetrySpan } from "@earendil-works/pi-telemetry";
import type { AgentRunRequest } from "@swarm-studio/adapter-kit";

export function withPiTelemetry<T>(
  _request: Pick<AgentRunRequest, "botId" | "runId" | "routineId">,
  work: (span?: TelemetrySpan) => Promise<T>,
): Promise<T> {
  return work();
}

export function withPiTelemetrySpan<T>(
  _name: string,
  _attributes: SpanAttributes,
  work: (span?: TelemetrySpan) => Promise<T>,
): Promise<T> {
  return work();
}

export function recordPiTelemetryContent(
  _span: TelemetrySpan | undefined,
  _key: string,
  _value: unknown,
): void {}
