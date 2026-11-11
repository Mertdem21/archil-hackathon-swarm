import { i18n } from "@lingui/core";
import type { ModelCatalogEntry, ModelCredential, ThinkingLevel } from "@swarm-studio/contracts";
import type { ConnectedModelChoice } from "@swarm-studio/core";
import { connectedModelChoices } from "@swarm-studio/core";

export { modelOptionKey, parseModelOptionKey } from "@swarm-studio/core";

/** The models the connected credentials can run, as one list for a picker. */
export function connectedModelOptions(
  credentials: ModelCredential[],
  catalog: ModelCatalogEntry[],
): ConnectedModelChoice[] {
  return connectedModelChoices(credentials, catalog);
}

export function thinkingLevelLabel(level: ThinkingLevel) {
  if (level === "xhigh") return i18n._({ id: "Extra high", message: "Extra high" });
  if (level === "low") return i18n._({ id: "Low", message: "Low" });
  if (level === "medium") return i18n._({ id: "Medium", message: "Medium" });
  if (level === "high") return i18n._({ id: "High", message: "High" });
  if (level === "minimal") return i18n._({ id: "Minimal", message: "Minimal" });
  if (level === "max") return i18n._({ id: "Max", message: "Max" });
  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
}
