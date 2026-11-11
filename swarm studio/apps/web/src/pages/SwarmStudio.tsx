import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SectionHeading,
  Spinner,
} from "@swarm-studio/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Monitor, Play, Plus, UsersRound, Workflow } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { cleanSwarmSpec, DeploySwarmForm, SwarmFields } from "../components/swarm/SwarmForm";
import { SwarmHeads, SwarmRunContent, SwarmStatus } from "../components/swarm/SwarmRun";
import { desktopBridge } from "../lib/desktop";
import type { SwarmDeployment, SwarmPreset } from "../lib/swarm-studio";
import {
  deleteSwarmPreset,
  editablePreset,
  EMPTY_SWARM,
  isSwarmTemplate,
  saveSwarmPreset,
  startSwarm,
  swarmStateKey,
  useSwarmRun,
  useSwarmScope,
  useSwarmState,
} from "../lib/swarm-studio";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

function SwarmHeader({
  title,
  backTo,
  children,
}: {
  title: string;
  backTo: string;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <header className="app-drag flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
      {desktopBridge() ? <WindowChrome /> : null}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Link
          to={backTo}
          aria-label={t`Back`}
          className={buttonVariants({
            variant: "ghost",
            size: "icon",
            className: "app-no-drag text-muted-foreground",
          })}
        >
          <ChevronLeft />
        </Link>
        <h1 className="truncate font-medium text-foreground">{title}</h1>
      </div>
      {children ? <div className="app-no-drag flex items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function SwarmStudioPage() {
  const { runId } = useParams<{ runId?: string }>();
  return runId ? <SwarmRunPage key={runId} runId={runId} /> : <SwarmLibrary />;
}

function SwarmLibrary() {
  const { t } = useLingui();
  const scope = useSwarmScope();
  const client = useQueryClient();
  const navigate = useNavigate();
  const state = useSwarmState(scope, true);
  const [editing, setEditing] = useState<SwarmPreset | "new">();
  const [deploying, setDeploying] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: swarmStateKey(scope) });
  const data = state.data;

  async function launch(spec: SwarmDeployment) {
    const { runId } = await startSwarm(scope.spaceId, spec);
    setDeploying(false);
    void refresh();
    navigate(`/app/swarms/${runId}`);
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <SwarmHeader title={t`Swarm Studio`} backTo="/app">
        <Button size="sm" onClick={() => setDeploying(true)} disabled={!data}>
          <Play />
          <Trans>Run a swarm</Trans>
        </Button>
      </SwarmHeader>
      <main className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-8 px-4 py-6 sm:px-6">
          {state.isPending ? <Spinner aria-label={t`Loading swarms`} className="size-5" /> : null}
          {state.isError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-body text-destructive" role="alert">
                {errorText(state.error)}
              </p>
              <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            </div>
          ) : null}
          {data?.runs.length ? (
            <section className="grid gap-2">
              <SectionHeading as="h2">
                <Trans>Runs</Trans>
              </SectionHeading>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {data.runs.map((run) => (
                  <li key={run.id}>
                    <Link
                      className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      to={`/app/swarms/${run.id}`}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                        <SwarmHeads workers={run.workers} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{run.spec.name}</p>
                        <p className="truncate text-body-sm text-muted-foreground">
                          {run.objective}
                        </p>
                      </div>
                      <SwarmStatus status={run.status} />
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data ? (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <SectionHeading as="h2">
                  <Trans>Presets</Trans>
                </SectionHeading>
                <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
                  <Plus />
                  <Trans>New preset</Trans>
                </Button>
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {data.presets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-start hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      type="button"
                      onClick={() => setEditing(preset)}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                        {preset.browser ? (
                          <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <Workflow className="size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium">{preset.name}</p>
                        <p className="truncate text-body-sm text-muted-foreground">
                          {preset.summary ?? preset.instructions}
                        </p>
                      </div>
                      <span className="hidden shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground sm:inline-flex">
                        <UsersRound className="size-4" aria-hidden="true" />
                        {plural(preset.workers, { one: "# worker", other: "# workers" })}
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
      {editing ? (
        <PresetEditor
          key={editing === "new" ? "new" : editing.id}
          preset={editing === "new" ? undefined : editing}
          spaceId={scope.spaceId}
          onClose={() => setEditing(undefined)}
          onChanged={refresh}
        />
      ) : null}
      {data && deploying ? (
        <Dialog open onOpenChange={setDeploying}>
          <DialogContent size="md">
            <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
              <DialogTitle>
                <Trans>Run a swarm</Trans>
              </DialogTitle>
            </DialogHeader>
            <div className="rk-scroll min-h-0 overflow-y-auto p-6">
              <DeploySwarmForm
                presets={data.presets}
                onDeploy={launch}
                onCancel={() => setDeploying(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function PresetEditor({
  preset,
  spaceId,
  onClose,
  onChanged,
}: {
  preset?: SwarmPreset;
  spaceId: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLingui();
  const template = preset && isSwarmTemplate(preset.id);
  const [spec, setSpec] = useState(preset ? editablePreset(preset) : EMPTY_SWARM);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string>();

  async function persist(action: () => Promise<unknown>) {
    setPending(true);
    setError(undefined);
    try {
      await action();
      void onChanged();
      onClose();
    } catch (failure) {
      setError(errorText(failure, t`Could not change this preset.`));
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) void persist(() => saveSwarmPreset(spaceId, cleanSwarmSpec(spec)));
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !pending) onClose();
        }}
      >
        <DialogContent size="md">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5">
            <DialogTitle>
              {template ? (
                <Trans>Customize preset</Trans>
              ) : preset ? (
                <Trans>Edit preset</Trans>
              ) : (
                <Trans>New preset</Trans>
              )}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="rk-scroll grid min-h-0 gap-5 overflow-y-auto p-6">
            <SwarmFields spec={spec} onChange={setSpec} />
            {error && !confirm ? (
              <p className="text-body text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {preset && !template ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="me-auto text-destructive"
                  disabled={pending}
                  onClick={() => setConfirm(true)}
                >
                  <Trans>Delete</Trans>
                </Button>
              ) : null}
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                disabled={pending || !spec.name.trim() || !spec.instructions.trim()}
              >
                {template ? <Trans>Save as new preset</Trans> : <Trans>Save preset</Trans>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {confirm && preset ? (
        <ConfirmDialog
          title={t`Delete ${preset.name}?`}
          confirmLabel={t`Delete preset`}
          error={error}
          busy={pending}
          onCancel={() => {
            setConfirm(false);
            setError(undefined);
          }}
          onConfirm={() => void persist(() => deleteSwarmPreset(spaceId, preset.id))}
        />
      ) : null}
    </>
  );
}

function SwarmRunPage({ runId }: { runId: string }) {
  const { t } = useLingui();
  const scope = useSwarmScope();
  const details = useSwarmRun(scope, runId, true);
  const run = details.data;
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <SwarmHeader title={run?.spec.name ?? t`Swarm run`} backTo="/app/swarms" />
      <main className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6">
          {details.isPending ? (
            <Spinner aria-label={t`Loading workers`} className="size-5" />
          ) : null}
          {details.isError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-body text-destructive" role="alert">
                {errorText(details.error)}
              </p>
              <Button variant="outline" size="sm" onClick={() => void details.refetch()}>
                <Trans>Retry</Trans>
              </Button>
            </div>
          ) : null}
          {run ? <SwarmRunContent run={run} spaceId={scope.spaceId} /> : null}
        </div>
      </main>
    </div>
  );
}
