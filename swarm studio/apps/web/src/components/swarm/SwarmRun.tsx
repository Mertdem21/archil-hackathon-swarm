import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@swarm-studio/chat-ui/web";
import {
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SectionHeading,
} from "@swarm-studio/ui-web";
import { ChevronDown, Globe2, Monitor, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { SwarmRun, SwarmWorker } from "../../lib/swarm-studio";
import {
  swarmScreenUrl,
  useSwarmRun,
  useSwarmScope,
  useSwarmScreenFrames,
  useSwarmState,
} from "../../lib/swarm-studio";

export function SwarmStatus({ status }: { status: SwarmWorker["status"] }) {
  const { t } = useLingui();
  const label = {
    queued: t`Queued`,
    starting: t`Starting`,
    running: t`Running`,
    done: t`Complete`,
    failed: t`Failed`,
  }[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-body-sm text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground/50",
          status === "running" && "bg-success motion-safe:animate-pulse",
          status === "done" && "bg-success",
          status === "failed" && "bg-destructive",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

const shapes = ["rounded-full", "rounded-sm", "[clip-path:polygon(50%_0%,100%_100%,0%_100%)]"];

export function SwarmHeads({
  workers,
  compact = false,
}: {
  workers?: SwarmWorker[];
  compact?: boolean;
}) {
  const active = workers?.some(({ status }) => status !== "done" && status !== "failed");
  if (!active) return <Workflow className="size-5 text-muted-foreground" aria-hidden="true" />;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-0.5",
        compact ? "max-w-[26px]" : "max-w-9",
      )}
      aria-hidden="true"
    >
      {workers?.map(({ index, status }) => (
        <span
          key={index}
          className={cn(
            "relative shrink-0 bg-foreground",
            compact ? "size-[7px]" : "size-2.5",
            shapes[index % shapes.length],
          )}
        >
          <span
            className={cn(
              "absolute inset-x-0 flex justify-center gap-px",
              compact ? "bottom-px" : "bottom-0.5",
              (status === "running" || status === "starting") && "motion-safe:animate-pulse",
            )}
            style={{ animationDelay: `${index * 150}ms` }}
          >
            <span
              className={cn("rounded-full bg-background", compact ? "size-px" : "size-[2px]")}
            />
            <span
              className={cn("rounded-full bg-background", compact ? "size-px" : "size-[2px]")}
            />
          </span>
        </span>
      ))}
    </div>
  );
}

export function ActiveSwarmAvatar({
  proposalId,
  fallback,
}: {
  proposalId: string;
  fallback: ReactNode;
}) {
  const { t } = useLingui();
  const scope = useSwarmScope();
  const state = useSwarmState(scope);
  const existing = state.data?.runs.find((run) => run.proposalId === proposalId);
  const details = useSwarmRun(scope, existing?.id);
  const run = details.data ?? existing;
  if (run?.status !== "running") return fallback;
  return (
    <span
      className="grid size-[26px] shrink-0 place-items-center rounded-full bg-muted"
      role="img"
      aria-label={t`Swarm running`}
    >
      <SwarmHeads workers={run.workers} compact />
    </span>
  );
}

function WorkerCard({
  worker,
  run,
  spaceId,
  liveFrame,
}: {
  worker: SwarmWorker;
  run: SwarmRun;
  spaceId: string | null;
  liveFrame?: string;
}) {
  const { t } = useLingui();
  const revision = worker.screenRevision;
  const fallback =
    revision && (worker.browserUrl || !worker.liveBrowser)
      ? swarmScreenUrl(run.id, worker.index, revision, spaceId)
      : undefined;
  const [loadedFallback, setLoadedFallback] = useState<string>();
  useEffect(() => {
    if (!fallback || (liveFrame && run.status === "running")) return;
    let current = true;
    const image = new Image();
    image.src = fallback;
    void image
      .decode()
      .then(() => {
        if (current) setLoadedFallback(fallback);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [fallback, liveFrame, run.status]);
  const image =
    run.status !== "running" && loadedFallback === fallback
      ? loadedFallback
      : (liveFrame ?? loadedFallback);
  const active = worker.status === "running" || worker.status === "starting";
  const sources = worker.sources?.filter(({ url }) => /^https?:\/\//i.test(url));
  return (
    <article
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      data-worker-index={worker.index}
    >
      <header className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
        <h3 className="truncate text-body font-medium" title={worker.role}>
          {worker.role}
        </h3>
        <SwarmStatus status={worker.status} />
      </header>
      {run.spec.browser ? (
        <div className="border-y border-border bg-muted/50">
          <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-body-sm text-muted-foreground">
            <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={worker.browserUrl}>
              {run.demo === "checkout" ? t`Sample checkout` : (worker.browserUrl ?? t`Browser`)}
            </span>
          </div>
          <div className="grid aspect-video place-items-center overflow-hidden bg-background">
            {image ? (
              <img
                className="size-full min-h-0 object-contain"
                src={image}
                alt={t`Live screen for ${worker.role}`}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-body-sm text-muted-foreground">
                <Monitor className="size-5" aria-hidden="true" />
                {active || worker.status === "queued" ? (
                  <Trans>Waiting for browser</Trans>
                ) : (
                  <Trans>No screen captured</Trans>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 px-4 py-3">
        {worker.activity ? (
          <p className="truncate text-body-sm text-muted-foreground" title={worker.activity}>
            {worker.activity}
          </p>
        ) : null}
        {worker.stress ? (
          <p className="text-body-sm text-muted-foreground">
            <Trans>
              {worker.stress.sessions} parallel sessions · {worker.stress.writes} submissions
            </Trans>
          </p>
        ) : null}
        {typeof worker.sampleEvidence?.payments === "number" ? (
          <p className="text-body-sm text-muted-foreground">
            {plural(worker.sampleEvidence.payments, {
              one: "Initial test · # payment recorded",
              other: "Initial test · # payments recorded",
            })}
          </p>
        ) : null}
        {worker.result || sources?.length ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-body marker:hidden [&::-webkit-details-marker]:hidden">
              <Trans>Findings</Trans>
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-2 break-words text-body text-muted-foreground">
              {worker.result ? <ChatMarkdown>{worker.result}</ChatMarkdown> : null}
              {sources?.length ? (
                <ul className="mt-2 grid gap-1">
                  {sources.map(({ title, url }) => (
                    <li key={url}>
                      <a
                        className="break-all underline underline-offset-2"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {title || url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export function SwarmRunContent({ run, spaceId }: { run: SwarmRun; spaceId: string | null }) {
  const frames = useSwarmScreenFrames(
    run.id,
    spaceId,
    Boolean(run.spec.browser) && run.status === "running",
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-body text-muted-foreground">{run.objective}</p>
        <SwarmStatus status={run.status} />
      </div>
      {run.error ? (
        <p className="text-body text-destructive" role="alert">
          {run.error}
        </p>
      ) : null}
      <div
        className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3"
        data-testid="swarm-screen-wall"
      >
        {run.workers.map((worker) => (
          <WorkerCard
            key={`${run.id}:${worker.index}`}
            worker={worker}
            run={run}
            spaceId={spaceId}
            liveFrame={frames?.[worker.index]}
          />
        ))}
      </div>
    </div>
  );
}

export function SwarmRunDialog({
  run,
  spaceId,
  open,
  onOpenChange,
}: {
  run: SwarmRun;
  spaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" className="h-auto min-h-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pe-14">
          <DialogTitle>{run.spec.name}</DialogTitle>
        </DialogHeader>
        <div className="rk-scroll min-h-0 overflow-y-auto p-6">
          <SectionHeading as="h2" className="sr-only">
            {run.spec.browser ? <Trans>Worker screens</Trans> : <Trans>Workers</Trans>}
          </SectionHeading>
          <SwarmRunContent run={run} spaceId={spaceId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
