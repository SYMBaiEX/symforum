"use client";

import { Button } from "@/components/ui/button";
import { convexRefs, type AiTelemetrySnapshotRecord } from "@/lib/convex-refs";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  Activity,
  Cpu,
  Gauge,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type ModelTotals = {
  requests: number;
  completed: number;
  failed: number;
  rejected: number;
  cancelled: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  averageQueueWaitMs: number;
  p95QueueWaitMs: number;
  averageFirstByteMs: number;
  p95FirstByteMs: number;
  averageTokensPerSecond: number;
  p50TokensPerSecond: number;
  apiRejections?: number;
  modelControls?: number;
};

type RuntimeSample = {
  id: string;
  at: string;
  modelHealthy?: boolean;
  gpu?: {
    name?: string;
    utilizationPercent?: number;
    memoryUsedMiB?: number;
    memoryTotalMiB?: number;
    temperatureCelsius?: number;
    powerDrawWatts?: number;
    powerLimitWatts?: number;
  } | null;
  llama?: {
    inputTokensTotal?: number;
    outputTokensTotal?: number;
    inputTokensPerSecond?: number;
    generationTokensPerSecond?: number;
    requestsProcessing?: number;
    requestsDeferred?: number;
    draftTokensTotal?: number;
    acceptedDraftTokensTotal?: number;
    draftStepsTotal?: number;
  };
};

type ModelTelemetry = {
  generatedAt: string;
  windowHours: number;
  retentionDays: number;
  totals: ModelTotals;
  speculativeDecoding: {
    draftTokens: number;
    acceptedDraftTokens: number;
    acceptanceRate: number;
  };
  keys: Array<{ keyId: string; keyName: string } & ModelTotals>;
  series: Array<{ at: string } & ModelTotals>;
  runtime: {
    latest: RuntimeSample | null;
    history: RuntimeSample[];
  };
  recent: Array<{
    id: string;
    at: string;
    type: string;
    requestId?: string;
    correlationId?: string;
    feature?: string;
    agent?: string;
    keyName?: string;
    endpoint?: string;
    model?: string;
    outcome?: string;
    statusCode?: number;
    totalMs?: number;
    queueWaitMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    completionTokensPerSecond?: number;
    action?: string;
  }>;
  storage: {
    eventCount: number;
    oldestAt: string | null;
    newestAt: string | null;
  };
};

type ModelTelemetryEnvelope = {
  model: ModelTelemetry;
  gateway: {
    gateway_running?: boolean;
    gateway_busy?: boolean;
    active_agents?: number;
    overall?: string;
    version?: string;
  } | null;
};

const windows = [
  { label: "24H", hours: 24 },
  { label: "7D", hours: 168 },
  { label: "30D", hours: 720 },
] as const;

export function AdminTelemetry() {
  const [hours, setHours] = useState(24);
  const [refreshKey, setRefreshKey] = useState(0);
  const [modelEnvelope, setModelEnvelope] =
    useState<ModelTelemetryEnvelope | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const editorial = useQuery(convexRefs.admin.aiTelemetrySnapshot, { hours });

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function load() {
      setModelLoading(true);
      try {
        const response = await fetch(
          `/api/admin/telemetry/model?hours=${hours}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = (await response.json().catch(() => null)) as
          | ModelTelemetryEnvelope
          | { error?: string }
          | null;
        if (!response.ok || !body || !("model" in body)) {
          throw new Error(
            body && "error" in body && body.error
              ? body.error
              : `Telemetry returned HTTP ${response.status}`,
          );
        }
        if (mounted) {
          setModelEnvelope(body);
          setModelError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted && mounted) {
          setModelError(
            error instanceof Error
              ? error.message
              : "Model telemetry unavailable",
          );
        }
      } finally {
        if (mounted) setModelLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(load, 15_000);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hours, refreshKey]);

  const model = modelEnvelope?.model;
  const runtime = model?.runtime.latest;
  const combinedRecent = useMemo(
    () => mergeRecent(model?.recent ?? [], editorial?.recent ?? []),
    [editorial?.recent, model?.recent],
  );

  return (
    <div className="space-y-6">
      <section className="border-y border-row-border bg-foreground/[0.015] py-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Activity className="h-4 w-4 text-emerald-500" />
              AI control plane / redacted telemetry
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Muse + editorial agent operations
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Live laptop inference, GPU and queue health are correlated with
              forum, reply, and newsletter agent activity. Prompts and generated
              content are never stored in this telemetry stream.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex border border-row-border bg-background p-1">
              {windows.map((window) => (
                <button
                  key={window.hours}
                  type="button"
                  className={cn(
                    "px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                    hours === window.hours
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setHours(window.hours)}
                >
                  {window.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={modelLoading}
            >
              <RefreshCw className={cn(modelLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-px overflow-hidden border border-row-border bg-row-border md:grid-cols-2 xl:grid-cols-5">
        <StatusCell
          label="Muse model"
          value={
            runtime?.modelHealthy
              ? "Healthy"
              : modelError
                ? "Unavailable"
                : "Checking"
          }
          tone={runtime?.modelHealthy ? "good" : modelError ? "bad" : "neutral"}
          detail={
            runtime?.at
              ? `sample ${relativeTime(runtime.at)}`
              : "awaiting sample"
          }
        />
        <StatusCell
          label="Hermes gateway"
          value={
            modelEnvelope?.gateway?.gateway_running ? "Running" : "Unknown"
          }
          tone={modelEnvelope?.gateway?.gateway_running ? "good" : "neutral"}
          detail={
            modelEnvelope?.gateway?.gateway_busy ? "agent processing" : "idle"
          }
        />
        <StatusCell
          label="Inference queue"
          value={`${number(runtime?.llama?.requestsProcessing)} active`}
          tone={(runtime?.llama?.requestsDeferred ?? 0) > 0 ? "warn" : "good"}
          detail={`${number(runtime?.llama?.requestsDeferred)} deferred`}
        />
        <StatusCell
          label="Telemetry store"
          value={model ? `${model.retentionDays} day retention` : "Unavailable"}
          tone={model ? "good" : "neutral"}
          detail={
            model
              ? `${integer(model.storage.eventCount)} events in window`
              : "redacted JSONL"
          }
        />
        <StatusCell
          label="Content logging"
          value="Disabled"
          tone="good"
          detail="metadata and counters only"
        />
      </section>

      {modelError ? (
        <section className="border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.15em] text-amber-600">
            Model telemetry unavailable
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{modelError}</p>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={Zap}
          label="Generation speed"
          value={`${decimal(runtime?.llama?.generationTokensPerSecond)} tok/s`}
          detail={`${decimal(model?.totals.averageTokensPerSecond)} average/request`}
        />
        <MetricCard
          icon={Timer}
          label="P95 latency"
          value={duration(model?.totals.p95LatencyMs)}
          detail={`${duration(model?.totals.p95QueueWaitMs)} queue p95`}
        />
        <MetricCard
          icon={Cpu}
          label="GPU load"
          value={percent(runtime?.gpu?.utilizationPercent)}
          detail={runtime?.gpu?.name ?? "GPU not reported"}
        />
        <MetricCard
          icon={HardDrive}
          label="VRAM"
          value={memory(runtime?.gpu?.memoryUsedMiB)}
          detail={`${memory(runtime?.gpu?.memoryTotalMiB)} total`}
        />
        <MetricCard
          icon={Activity}
          label="Inference requests"
          value={integer(model?.totals.requests)}
          detail={`${integer(model?.totals.completed)} completed`}
        />
        <MetricCard
          icon={Gauge}
          label="Error rate"
          value={percent(model?.totals.errorRate)}
          detail={`${integer(model?.totals.rejected)} rejected`}
          warning={(model?.totals.errorRate ?? 0) > 0}
        />
        <MetricCard
          icon={Zap}
          label="DFlash acceptance"
          value={percent(model?.speculativeDecoding.acceptanceRate)}
          detail={`${integer(model?.speculativeDecoding.acceptedDraftTokens)} accepted drafts`}
        />
        <MetricCard
          icon={ShieldCheck}
          label="Agent quality"
          value={decimal(editorial?.totals.averageQuality)}
          detail={`${integer(editorial?.totals.published)} posts published`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel
          eyebrow="Throughput"
          title="Inference traffic"
          aside={`${integer(model?.totals.inputTokens)} in / ${integer(model?.totals.outputTokens)} out`}
        >
          <SeriesBars
            rows={(model?.series ?? []).map((row) => ({
              key: row.at,
              label: compactTime(row.at, hours),
              primary: row.outputTokens,
              secondary: row.failed + row.rejected,
              title: `${row.requests} requests · ${row.outputTokens} output tokens`,
            }))}
            empty={
              modelLoading
                ? "Loading inference telemetry"
                : "No inference requests in this window"
            }
          />
        </Panel>

        <Panel eyebrow="Laptop" title="Runtime envelope">
          <dl className="divide-y divide-row-border border-y border-row-border">
            <RuntimeRow
              label="Temperature"
              value={temperature(runtime?.gpu?.temperatureCelsius)}
            />
            <RuntimeRow
              label="GPU power"
              value={`${decimal(runtime?.gpu?.powerDrawWatts)} / ${decimal(runtime?.gpu?.powerLimitWatts)} W`}
            />
            <RuntimeRow
              label="Prompt throughput"
              value={`${decimal(runtime?.llama?.inputTokensPerSecond)} tok/s`}
            />
            <RuntimeRow
              label="Cumulative tokens"
              value={`${integer(runtime?.llama?.inputTokensTotal)} in · ${integer(runtime?.llama?.outputTokensTotal)} out`}
            />
            <RuntimeRow
              label="First byte p95"
              value={duration(model?.totals.p95FirstByteMs)}
            />
          </dl>
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="SYMBaiEX agents"
          title="Editorial production"
          aside={`${integer(editorial?.totals.agentRuns)} runs · ${integer(editorial?.totals.replies)} replies`}
        >
          <AgentTable snapshot={editorial} />
        </Panel>
        <Panel
          eyebrow="Routing"
          title="Model attempts + fallbacks"
          aside={`${integer(editorial?.totals.fallbackAttempts)} fallback attempts`}
        >
          <ModelTable snapshot={editorial} />
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel eyebrow="Access" title="Usage by API key">
          <KeyUsageTable rows={model?.keys ?? []} />
        </Panel>
        <Panel
          eyebrow="Correlated history"
          title="Recent operations"
          aside="newest first"
        >
          <RecentTimeline rows={combinedRecent} />
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-row-border bg-background">
      <header className="flex items-end justify-between gap-4 border-b border-row-border p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
          <h3 className="mt-2 text-lg font-semibold">{title}</h3>
        </div>
        {aside ? (
          <p className="text-right font-mono text-[10px] uppercase text-muted-foreground">
            {aside}
          </p>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StatusCell({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="bg-background p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            tone === "good" && "bg-emerald-500",
            tone === "warn" && "bg-amber-500",
            tone === "bad" && "bg-red-500",
            tone === "neutral" && "bg-muted-foreground/40",
          )}
        />
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-3 text-sm font-semibold">{value}</p>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  warning = false,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div className="border border-row-border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <Icon
          className={cn(
            "h-4 w-4",
            warning ? "text-amber-500" : "text-muted-foreground",
          )}
        />
      </div>
      <p className="mt-4 font-mono text-2xl font-semibold tracking-tight">
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SeriesBars({
  rows,
  empty,
}: {
  rows: Array<{
    key: string;
    label: string;
    primary: number;
    secondary: number;
    title: string;
  }>;
  empty: string;
}) {
  if (!rows.length) {
    return <EmptyState>{empty}</EmptyState>;
  }
  const visible = rows.slice(-36);
  const max = Math.max(1, ...visible.map((row) => row.primary));
  return (
    <div>
      <div className="flex h-44 items-end gap-1 border-b border-row-border pt-4">
        {visible.map((row) => (
          <div
            key={row.key}
            className="group flex min-w-0 flex-1 flex-col justify-end"
            title={row.title}
          >
            {row.secondary > 0 ? <div className="mb-1 h-1 bg-red-500" /> : null}
            <div
              className="min-h-1 bg-foreground/70 transition-colors group-hover:bg-emerald-500"
              style={{ height: `${Math.max(3, (row.primary / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] uppercase text-muted-foreground">
        <span>{visible[0]?.label}</span>
        <span>{visible.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs">{value}</dd>
    </div>
  );
}

function AgentTable({
  snapshot,
}: {
  snapshot: AiTelemetrySnapshotRecord | undefined;
}) {
  if (snapshot === undefined)
    return <EmptyState>Loading editorial telemetry</EmptyState>;
  if (!snapshot.agents.length)
    return <EmptyState>No agent activity in this window</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="font-mono uppercase text-muted-foreground">
          <tr className="border-b border-row-border">
            <th className="pb-3 font-normal">Agent</th>
            <th className="pb-3 text-right font-normal">Runs</th>
            <th className="pb-3 text-right font-normal">Published</th>
            <th className="pb-3 text-right font-normal">Replies</th>
            <th className="pb-3 text-right font-normal">Failed</th>
            <th className="pb-3 text-right font-normal">Quality</th>
            <th className="pb-3 text-right font-normal">Tokens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-row-border">
          {snapshot.agents.map((agent) => (
            <tr key={agent.agentSlug}>
              <td className="py-3 font-semibold">{agent.agentSlug}</td>
              <td className="py-3 text-right font-mono">
                {integer(agent.runs)}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(agent.published)}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(agent.replies)}
              </td>
              <td
                className={cn(
                  "py-3 text-right font-mono",
                  agent.failed > 0 && "text-red-500",
                )}
              >
                {integer(agent.failed)}
              </td>
              <td className="py-3 text-right font-mono">
                {decimal(agent.averageQuality)}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(agent.inputTokens + agent.outputTokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({
  snapshot,
}: {
  snapshot: AiTelemetrySnapshotRecord | undefined;
}) {
  if (snapshot === undefined)
    return <EmptyState>Loading route telemetry</EmptyState>;
  if (!snapshot.models.length)
    return <EmptyState>No model routes in this window</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="font-mono uppercase text-muted-foreground">
          <tr className="border-b border-row-border">
            <th className="pb-3 font-normal">Model</th>
            <th className="pb-3 text-right font-normal">Attempts</th>
            <th className="pb-3 text-right font-normal">Fallbacks</th>
            <th className="pb-3 text-right font-normal">Failures</th>
            <th className="pb-3 text-right font-normal">Tokens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-row-border">
          {snapshot.models.map((model) => (
            <tr key={model.model}>
              <td
                className="max-w-56 truncate py-3 font-mono"
                title={model.model}
              >
                {model.model}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(model.attempts)}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(model.fallbacks)}
              </td>
              <td
                className={cn(
                  "py-3 text-right font-mono",
                  model.failures > 0 && "text-red-500",
                )}
              >
                {integer(model.failures)}
              </td>
              <td className="py-3 text-right font-mono">
                {integer(model.inputTokens + model.outputTokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyUsageTable({ rows }: { rows: ModelTelemetry["keys"] }) {
  if (!rows.length) return <EmptyState>No key usage in this window</EmptyState>;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.keyId}
          className="border-b border-row-border pb-3 last:border-0 last:pb-0"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{row.keyName}</p>
              <p className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">
                {row.keyId.slice(0, 8)} · {integer(row.totalTokens)} tokens
              </p>
            </div>
            <p className="font-mono text-sm">{integer(row.requests)}</p>
          </div>
          <div className="mt-2 flex gap-4 font-mono text-[9px] uppercase text-muted-foreground">
            <span>{decimal(row.averageTokensPerSecond)} tok/s</span>
            <span>{duration(row.p95LatencyMs)} p95</span>
            <span className={cn(row.errorRate > 0 && "text-red-500")}>
              {percent(row.errorRate)} errors
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

type TimelineRow = {
  id: string;
  at: number;
  source: "laptop" | "editorial";
  label: string;
  status: string;
  detail: string;
  durationMs?: number;
};

function RecentTimeline({ rows }: { rows: TimelineRow[] }) {
  if (!rows.length)
    return <EmptyState>No telemetry events in this window</EmptyState>;
  return (
    <div className="max-h-[440px] overflow-y-auto">
      {rows.slice(0, 60).map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[82px_1fr_auto] gap-3 border-b border-row-border py-3 last:border-0"
        >
          <div className="font-mono text-[9px] uppercase text-muted-foreground">
            <p>{formatClock(row.at)}</p>
            <p className="mt-1">{row.source}</p>
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{row.label}</p>
            <p
              className="mt-1 truncate font-mono text-[9px] text-muted-foreground"
              title={row.detail}
            >
              {row.detail}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={row.status} />
            {row.durationMs !== undefined ? (
              <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                {duration(row.durationMs)}
              </p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const negative = ["failed", "rejected", "cancelled"].includes(status);
  const positive = [
    "completed",
    "published",
    "replied",
    "sent",
    "generated",
  ].includes(status);
  return (
    <span
      className={cn(
        "inline-block border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em]",
        negative && "border-red-500/40 text-red-500",
        positive && "border-emerald-500/40 text-emerald-600",
        !negative && !positive && "border-row-border text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-10 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
      {children}
    </div>
  );
}

function mergeRecent(
  modelRows: ModelTelemetry["recent"],
  editorialRows: AiTelemetrySnapshotRecord["recent"],
): TimelineRow[] {
  return [
    ...modelRows.map((row) => ({
      id: `model:${row.id}`,
      at: Date.parse(row.at),
      source: "laptop" as const,
      label: row.feature ?? row.action ?? row.type.replaceAll("_", " "),
      status:
        row.outcome ??
        (row.statusCode && row.statusCode >= 400 ? "failed" : "completed"),
      detail:
        [row.agent, row.keyName, row.model, row.correlationId]
          .filter(Boolean)
          .join(" · ") || "model service event",
      durationMs: row.totalMs,
    })),
    ...editorialRows.map((row) => ({
      id: `editorial:${row.kind}:${row.correlationId}:${row.at}:${row.stage}`,
      at: row.at,
      source: "editorial" as const,
      label: `${row.agentSlug ?? "system"} · ${row.stage}`,
      status: row.status,
      detail: [row.model, row.correlationId, row.detail]
        .filter(Boolean)
        .join(" · "),
      durationMs: row.durationMs,
    })),
  ]
    .filter((row) => Number.isFinite(row.at))
    .sort((left, right) => right.at - left.at);
}

function number(value: number | undefined) {
  return value === undefined ? "—" : String(value);
}

function integer(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function decimal(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function percent(value: number | undefined) {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : `${decimal(value)}%`;
}

function duration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1_000
    ? `${decimal(value / 1_000)}s`
    : `${Math.round(value)}ms`;
}

function memory(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1_024
    ? `${decimal(value / 1_024)} GiB`
    : `${Math.round(value)} MiB`;
}

function temperature(value: number | undefined) {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : `${decimal(value)} °C`;
}

function relativeTime(value: string) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "unknown";
  if (elapsed < 60_000)
    return `${Math.max(0, Math.round(elapsed / 1_000))}s ago`;
  return `${Math.round(elapsed / 60_000)}m ago`;
}

function compactTime(value: string, hours: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return hours <= 48
    ? date.toLocaleTimeString([], { hour: "numeric" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatClock(value: number) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
