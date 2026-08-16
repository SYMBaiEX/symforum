"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { convexRefs } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { useAction, useMutation, useQuery } from "convex/react";
import { DatabaseZap, Pause, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const adapters = [
  ["cisa-kev", "CISA KEV"],
  ["github-advisories", "GitHub advisories"],
  ["github-releases", "GitHub releases"],
  ["crossref", "Crossref metadata"],
  ["first-party-research", "First-party research"],
] as const;

export function AdminEvidence() {
  const data = useQuery(convexRefs.evidenceAdmin.dashboard, {});
  const setSourceStatus = useMutation(convexRefs.evidenceAdmin.setSourceStatus);
  const runIngestion = useAction(convexRefs.evidenceAdmin.runIngestion);
  const initializeCatalog = useAction(
    convexRefs.evidenceAdmin.initializeCatalog,
  );
  const [running, setRunning] = useState<string | null>(null);

  const run = async (
    key: string,
    task: () => Promise<unknown>,
    success: string,
  ) => {
    setRunning(key);
    try {
      await task();
      toast.success(success);
    } catch (error) {
      reportAppError(error, {
        scope: "admin",
        eventType: "evidence_control_failed",
        component: "AdminEvidence",
        action: key,
        notify: false,
      });
      toast.error(
        error instanceof Error ? error.message : "Evidence operation failed",
      );
    } finally {
      setRunning(null);
    }
  };

  if (data === undefined)
    return (
      <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
        Loading evidence controls
      </div>
    );

  return (
    <div className="space-y-7 py-3">
      <section className="flex flex-wrap items-start justify-between gap-4 border-y border-row-border py-5">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Evidence control center
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            Bounded source operations
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Counts and rows are capped server-side. This console never exposes
            source credentials, raw payloads, or payment controls.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={running !== null}
          onClick={() =>
            void run(
              "catalog",
              initializeCatalog,
              "Catalog initialization checked",
            )
          }
        >
          <DatabaseZap />
          {running === "catalog" ? "Checking" : "Initialize catalog"}
        </Button>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Sources", data.counts.sources],
          ["Documents", data.counts.documents],
          ["Changes", data.counts.changes],
          ["Jobs", data.counts.researchJobs + data.counts.exportJobs],
          ["Products", data.counts.products],
          ["Datasets", data.counts.datasets],
          ["Benchmarks", data.counts.benchmarks],
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-row-border p-4">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Named ingestion
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs exactly one configured adapter after server-side admin
              re-authorization.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {adapters.map(([adapter, label]) => (
              <Button
                key={adapter}
                size="sm"
                variant="outline"
                disabled={running !== null}
                onClick={() =>
                  void run(
                    adapter,
                    () => runIngestion({ adapter }),
                    `${label} started`,
                  )
                }
              >
                <RefreshCw />
                {running === adapter ? "Running" : label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Sources (latest {data.bounds.sources})
        </p>
        <div className="mt-3 divide-y divide-row-border border-y border-row-border">
          {data.sources.map((source) => (
            <div
              key={source.sourceId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{source.name}</p>
                  <Badge variant="outline">{source.status}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {source.sourceKey} · updated {formatDate(source.updatedAt)}
                </p>
                {source.lastErrorMessage ? (
                  <p className="mt-1 text-xs text-destructive">
                    {source.lastErrorMessage}
                  </p>
                ) : null}
              </div>
              {source.status === "retired" ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={running !== null}
                  onClick={() =>
                    void run(
                      `source-${source.sourceId}`,
                      () =>
                        setSourceStatus({
                          sourceId: source.sourceId,
                          status:
                            source.status === "active" ? "paused" : "active",
                        }),
                      source.status === "active"
                        ? "Source paused"
                        : "Source resumed",
                    )
                  }
                >
                  {source.status === "active" ? <Pause /> : <Play />}
                  {source.status === "active" ? "Pause" : "Resume"}
                </Button>
              )}
            </div>
          ))}
          {data.sources.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">
              No evidence sources have been registered.
            </p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Recent changes
          </p>
          <div className="mt-3 space-y-3">
            {data.changes.map((event) => (
              <div
                key={event.eventKey}
                className="border border-row-border p-3"
              >
                <p className="text-sm">{event.summary}</p>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {event.entityType} · {event.kind} ·{" "}
                  {formatDate(event.occurredAt)}
                </p>
              </div>
            ))}
            {data.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent public change events.
              </p>
            ) : null}
          </div>
        </section>
        <section>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Recent queued jobs
          </p>
          <div className="mt-3 space-y-3">
            {data.jobs.map((job) => (
              <div key={job.id} className="border border-row-border p-3">
                <p className="text-sm capitalize">
                  {job.type} · {job.status}
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {formatDate(job.updatedAt)}
                </p>
                {job.errorMessage ? (
                  <p className="mt-1 text-xs text-destructive">
                    {job.errorMessage}
                  </p>
                ) : null}
              </div>
            ))}
            {data.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No queued research or export jobs.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
