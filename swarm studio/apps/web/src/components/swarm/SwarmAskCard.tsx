import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "@swarm-studio/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { Monitor, UsersRound } from "lucide-react";
import { useState } from "react";
import type { SwarmDeployment, SwarmTemplate } from "../../lib/swarm-studio";
import {
  startSwarm,
  swarmStateKey,
  useSwarmRun,
  useSwarmScope,
  useSwarmState,
} from "../../lib/swarm-studio";
import { errorText } from "../../lib/user-error";
import { BuiCard } from "../ai/primitives";
import { DeploySwarmForm } from "./SwarmForm";
import { SwarmHeads, SwarmRunDialog, SwarmStatus } from "./SwarmRun";

export function SwarmAskCard({
  proposalId,
  threadId,
  objective,
  preset,
  answered,
  canAnswer,
  onDismiss,
}: {
  proposalId: string;
  threadId: string;
  objective: string;
  preset?: SwarmTemplate;
  answered: boolean;
  canAnswer: boolean;
  onDismiss: () => Promise<void>;
}) {
  const { t } = useLingui();
  const scope = useSwarmScope();
  const client = useQueryClient();
  const state = useSwarmState(scope);
  const [started, setStarted] = useState<string>();
  const [dismissed, setDismissed] = useState(false);
  const [wallOpen, setWallOpen] = useState(false);
  const existing = state.data?.runs.find((run) => run.proposalId === proposalId);
  const runId = started ?? existing?.id;
  const details = useSwarmRun(scope, runId, wallOpen);
  const run = details.data ?? existing;

  async function deploy(spec: SwarmDeployment) {
    const { runId: id } = await startSwarm(scope.spaceId, { ...spec, proposalId, threadId });
    setStarted(id);
    void client.invalidateQueries({ queryKey: swarmStateKey(scope) });
  }

  async function dismiss() {
    await onDismiss();
    setDismissed(true);
  }

  return (
    <BuiCard className="w-full min-w-0 max-w-xl space-y-4 px-5 py-4" data-testid="swarm-ask-card">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          <SwarmHeads workers={run?.workers} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-lg font-medium">
            {run?.spec.name ?? t`Deploy a swarm?`}
          </div>
          {run ? <SwarmStatus status={run.status} /> : null}
        </div>
        {run ? (
          <Button variant="outline" size="sm" onClick={() => setWallOpen(true)}>
            {run.spec.browser ? <Monitor /> : <UsersRound />}
            {run.spec.browser && run.status === "running" ? (
              <Trans>Watch screens</Trans>
            ) : run.spec.browser ? (
              <Trans>Worker screens</Trans>
            ) : (
              <Trans>View workers</Trans>
            )}
          </Button>
        ) : null}
      </div>
      {run ? (
        <SwarmRunDialog
          run={run}
          spaceId={scope.spaceId}
          open={wallOpen}
          onOpenChange={setWallOpen}
        />
      ) : runId && details.isError ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-body text-destructive" role="alert">
            {errorText(details.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void details.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : runId || state.isPending ? (
        <Spinner className="size-4" aria-label={t`Loading swarm`} />
      ) : state.isError && !state.data ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-body text-destructive" role="alert">
            {errorText(state.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void state.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : dismissed || answered ? (
        <p className="text-body text-muted-foreground">
          <Trans>Swarm deployment dismissed.</Trans>
        </p>
      ) : canAnswer && state.data ? (
        <DeploySwarmForm
          presets={state.data.presets}
          initialPreset={preset}
          initialObjective={objective}
          onDeploy={deploy}
          onCancel={dismiss}
          cancelLabel={t`Dismiss`}
        />
      ) : (
        <p className="text-body text-muted-foreground">{objective}</p>
      )}
    </BuiCard>
  );
}
