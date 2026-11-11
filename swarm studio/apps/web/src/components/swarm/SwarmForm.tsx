import { Trans, useLingui } from "@lingui/react/macro";
import { requestsSampleCheckout } from "@swarm-studio/contracts";
import { Button, Input, NativeSelect, NativeSelectOption, Textarea } from "@swarm-studio/ui-web";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import type {
  SwarmDeployment,
  SwarmPreset,
  SwarmSpec,
  SwarmTemplate,
} from "../../lib/swarm-studio";
import { editablePreset, EMPTY_SWARM } from "../../lib/swarm-studio";
import { errorText } from "../../lib/user-error";

export function SwarmFields({
  spec,
  onChange,
  identity = true,
}: {
  spec: SwarmSpec;
  onChange: (spec: SwarmSpec) => void;
  identity?: boolean;
}) {
  const { t } = useLingui();
  const workerLabelId = useId();
  return (
    <div className="grid gap-4">
      {identity ? (
        <>
          <label className="grid gap-1.5 text-body font-medium">
            <Trans>Name</Trans>
            <Input
              required
              maxLength={80}
              value={spec.name}
              onChange={(event) => onChange({ ...spec, name: event.currentTarget.value })}
            />
          </label>
          <label className="grid gap-1.5 text-body font-medium">
            <Trans>Instructions</Trans>
            <Textarea
              required
              maxLength={4_000}
              rows={3}
              value={spec.instructions}
              onChange={(event) => onChange({ ...spec, instructions: event.currentTarget.value })}
            />
          </label>
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5 text-body font-medium">
          <span id={workerLabelId}>
            <Trans>Workers</Trans>
          </span>
          <div
            className="flex h-9 w-fit items-center rounded-lg border border-input"
            aria-labelledby={workerLabelId}
            role="group"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t`Fewer workers`}
              disabled={spec.workers <= 1}
              onClick={() => onChange({ ...spec, workers: spec.workers - 1 })}
            >
              <Minus />
            </Button>
            <output className="w-8 text-center tabular-nums" aria-label={t`Worker count`}>
              {spec.workers}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t`More workers`}
              disabled={spec.workers >= 6}
              onClick={() => onChange({ ...spec, workers: spec.workers + 1 })}
            >
              <Plus />
            </Button>
          </div>
        </div>
        <label className="grid gap-1.5 text-body font-medium">
          <Trans>Filesystem</Trans>
          <NativeSelect
            className="w-full"
            value={spec.filesystem}
            onChange={(event) =>
              onChange({
                ...spec,
                filesystem: event.currentTarget.value === "private" ? "private" : "shared",
              })
            }
          >
            <NativeSelectOption value="shared">
              <Trans>Shared</Trans>
            </NativeSelectOption>
            <NativeSelectOption value="private">
              <Trans>Private</Trans>
            </NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1.5 text-body font-medium">
          <Trans>Runtime</Trans>
          <NativeSelect
            className="w-full"
            value={spec.runtime}
            onChange={(event) =>
              onChange({
                ...spec,
                runtime: event.currentTarget.value === "serverless" ? "serverless" : "sandbox",
              })
            }
          >
            <NativeSelectOption value="sandbox">
              <Trans>Sandbox</Trans>
            </NativeSelectOption>
            <NativeSelectOption value="serverless" disabled={spec.browser}>
              <Trans>Serverless</Trans>
            </NativeSelectOption>
          </NativeSelect>
        </label>
      </div>
      <details className="group rounded-lg border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-body text-muted-foreground marker:hidden [&::-webkit-details-marker]:hidden">
          <Trans>Worker tools and roles</Trans>
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="grid gap-3 border-t border-border p-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                className="accent-primary"
                checked={spec.browser}
                onChange={(event) => {
                  const browser = event.currentTarget.checked;
                  onChange({ ...spec, browser, runtime: browser ? "sandbox" : spec.runtime });
                }}
              />
              <Trans>Live browser</Trans>
            </label>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                className="accent-primary"
                checked={spec.search}
                onChange={(event) => onChange({ ...spec, search: event.currentTarget.checked })}
              />
              <Trans>Web search</Trans>
            </label>
          </div>
          <label className="grid gap-1.5 text-body font-medium">
            <Trans>Roles</Trans>
            <Textarea
              rows={3}
              maxLength={1_200}
              placeholder={t`One role per line`}
              value={(spec.roles ?? []).join("\n")}
              onChange={(event) =>
                onChange({ ...spec, roles: event.currentTarget.value.split("\n").slice(0, 6) })
              }
            />
          </label>
        </div>
      </details>
    </div>
  );
}

export function cleanSwarmSpec(spec: SwarmSpec): SwarmSpec {
  return {
    ...spec,
    name: spec.name.trim(),
    instructions: spec.instructions.trim(),
    roles: spec.roles?.map((role) => role.trim()),
  };
}

export function DeploySwarmForm({
  presets,
  initialPreset,
  initialObjective = "",
  onDeploy,
  onCancel,
  cancelLabel,
}: {
  presets: SwarmPreset[];
  initialPreset?: SwarmTemplate;
  initialObjective?: string;
  onDeploy: (spec: SwarmDeployment) => Promise<void>;
  onCancel: () => void | Promise<void>;
  cancelLabel?: string;
}) {
  const { t } = useLingui();
  const first =
    presets.find(({ id }) => id === initialPreset) ??
    (initialPreset === "custom" ? undefined : presets[0]);
  const [presetId, setPresetId] = useState(first?.id ?? "");
  const [spec, setSpec] = useState<SwarmSpec>(first ? editablePreset(first) : EMPTY_SWARM);
  const [objective, setObjective] = useState(initialObjective);
  const [sampleOverride, setSampleOverride] = useState<boolean>();
  const [savePreset, setSavePreset] = useState(false);
  const [pending, setPending] = useState<"deploy" | "cancel">();
  const [error, setError] = useState<string>();
  const showSample = spec.browser && spec.runtime === "sandbox";
  const sample = showSample && (sampleOverride ?? requestsSampleCheckout(objective));
  const sampleTask = t`Test the sample checkout on desktop and mobile. Look for duplicate payments under concurrent submissions.`;
  const draft = !presetId || savePreset;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("deploy");
    setError(undefined);
    try {
      await onDeploy({
        ...cleanSwarmSpec(spec),
        objective: objective.trim(),
        demo: sample ? "checkout" : null,
        savePreset,
      });
    } catch (failure) {
      setError(errorText(failure, t`Could not deploy the swarm.`));
    } finally {
      setPending(undefined);
    }
  }

  function selectPreset(id: string) {
    const selected = presets.find((preset) => preset.id === id);
    setPresetId(id);
    setSpec(selected ? editablePreset(selected) : EMPTY_SWARM);
    setSampleOverride(undefined);
    setSavePreset(false);
  }

  async function cancel() {
    setPending("cancel");
    setError(undefined);
    try {
      await onCancel();
    } catch (failure) {
      setError(errorText(failure, t`Could not dismiss the swarm.`));
    } finally {
      setPending(undefined);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1.5 text-body font-medium">
        <Trans>Swarm</Trans>
        <NativeSelect
          className="w-full"
          value={presetId}
          onChange={(event) => selectPreset(event.currentTarget.value)}
        >
          {presets.map(({ id, name }) => (
            <NativeSelectOption key={id} value={id}>
              {name}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="">
            <Trans>New custom swarm</Trans>
          </NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-body font-medium">
        <Trans>Task</Trans>
        <Textarea
          required
          maxLength={8_000}
          rows={3}
          placeholder={t`What should the workers do?`}
          value={objective}
          onChange={(event) => setObjective(event.currentTarget.value)}
        />
      </label>
      {showSample ? (
        <Button
          type="button"
          variant={sample ? "secondary" : "outline"}
          size="sm"
          aria-pressed={sample}
          className="w-fit"
          onClick={() => {
            if (!sample && !objective.trim()) setObjective(sampleTask);
            setSampleOverride(!sample);
          }}
        >
          {sample ? <Trans>Sample checkout selected</Trans> : <Trans>Use sample checkout</Trans>}
        </Button>
      ) : null}
      <SwarmFields spec={spec} onChange={setSpec} identity={draft} />
      <label className="flex items-center gap-2 text-body text-muted-foreground">
        <input
          type="checkbox"
          className="accent-primary"
          checked={savePreset}
          onChange={(event) => setSavePreset(event.currentTarget.checked)}
        />
        <Trans>Save as a new preset</Trans>
      </label>
      {error ? (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={Boolean(pending)}
          onClick={() => void cancel()}
        >
          {cancelLabel ?? t`Cancel`}
        </Button>
        <Button
          type="submit"
          disabled={
            Boolean(pending) || !objective.trim() || !spec.name.trim() || !spec.instructions.trim()
          }
        >
          {pending === "deploy" ? <Trans>Deploying</Trans> : <Trans>Deploy swarm</Trans>}
        </Button>
      </div>
    </form>
  );
}
