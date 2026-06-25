"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  convexRefs,
  type SystemLogRecord,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Check, Eye, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type LogFilter = "open" | "reviewed" | "resolved" | "all";

const filters: LogFilter[] = ["open", "reviewed", "resolved", "all"];

export function AdminSystemLogs() {
  const [filter, setFilter] = useState<LogFilter>("open");
  const status = filter === "all" ? undefined : filter;
  const logs = useQuery(convexRefs.admin.listSystemLogs, {
    ...(status ? { status } : {}),
    limit: 80,
  });
  const summary = useQuery(convexRefs.admin.summarySystemLogs, {});
  const updateStatus = useMutation(convexRefs.admin.updateSystemLogStatus);
  const deleteLog = useMutation(convexRefs.admin.deleteSystemLog);

  async function setStatus(logId: string, nextStatus: SystemLogRecord["status"]) {
    try {
      await updateStatus({ logId, status: nextStatus });
      toast.success(`Log ${nextStatus}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update log",
      );
    }
  }

  async function remove(logId: string) {
    if (!window.confirm("Delete this system log?")) {
      return;
    }
    try {
      await deleteLog({ logId });
      toast.success("Log deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete log");
    }
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            System logs
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Operational feed</h2>
        </div>
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase">
          {filters.map((nextFilter) => (
            <Button
              key={nextFilter}
              className={cn(
                "h-7 px-2 font-mono text-[10px] uppercase",
                filter === nextFilter ? "bg-foreground text-background" : null,
              )}
              onClick={() => setFilter(nextFilter)}
              size="sm"
              type="button"
              variant={filter === nextFilter ? "default" : "outline"}
            >
              {nextFilter}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 font-mono text-[10px] uppercase text-muted-foreground md:grid-cols-4">
        <Metric label="Open" value={summary?.sampleSize.open ?? 0} />
        <Metric label="Reviewed" value={summary?.sampleSize.reviewed ?? 0} />
        <Metric label="Errors" value={summary?.sampleSize.errors ?? 0} />
        <Metric label="Warnings" value={summary?.sampleSize.warnings ?? 0} />
      </div>
      <div className="mt-5 grid gap-1">
        {logs === undefined ? (
          <p className="py-4 font-mono text-xs uppercase text-muted-foreground">
            Loading system logs
          </p>
        ) : logs.length === 0 ? (
          <p className="py-4 font-mono text-xs uppercase text-muted-foreground">
            No logs in this view
          </p>
        ) : (
          logs.map((log) => (
            <SystemLogRow
              key={log._id}
              log={log}
              onDelete={() => remove(log._id)}
              onResolve={() => setStatus(log._id, "resolved")}
              onReview={() => setStatus(log._id, "reviewed")}
              onReopen={() => setStatus(log._id, "open")}
            />
          ))
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xl font-semibold text-foreground">{value}</p>
      <p>{label}</p>
    </div>
  );
}

function SystemLogRow({
  log,
  onDelete,
  onReopen,
  onResolve,
  onReview,
}: {
  log: SystemLogRecord;
  onDelete: () => void;
  onReopen: () => void;
  onResolve: () => void;
  onReview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="py-3">
      <div className="grid gap-3 md:grid-cols-[8.5rem_minmax(0,1fr)_auto] md:items-start">
        <div className="font-mono text-[10px] uppercase text-muted-foreground">
          <p>{formatDate(log.createdAt)}</p>
          <p>{log.source} / {log.scope}</p>
          {log.occurrences > 1 ? <p>{log.occurrences} repeats</p> : null}
        </div>
        <button
          className="min-w-0 text-left"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={log.level === "error" ? "default" : "outline"}
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {log.level}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-none font-mono text-[10px] uppercase"
            >
              {log.status}
            </Badge>
            <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              {log.eventType}
            </p>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6">{log.message}</p>
          <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
            {[log.method, log.path, log.statusCode].filter(Boolean).join(" / ")}
          </p>
        </button>
        <div className="flex items-center justify-start gap-1 md:justify-end">
          {log.status === "open" ? (
            <Button
              aria-label="Mark reviewed"
              onClick={onReview}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Eye />
            </Button>
          ) : (
            <Button
              aria-label="Reopen"
              onClick={onReopen}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Eye />
            </Button>
          )}
          <Button
            aria-label="Resolve"
            onClick={onResolve}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Check />
          </Button>
          <Button
            aria-label="Delete log"
            onClick={onDelete}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 grid gap-2 border-l border-row-border pl-3 font-mono text-[10px] uppercase text-muted-foreground">
          <p>Fingerprint: {log.fingerprint}</p>
          {log.component ? <p>Component: {log.component}</p> : null}
          {log.action ? <p>Action: {log.action}</p> : null}
          {log.entityType || log.entityId ? (
            <p>
              Entity: {[log.entityType, log.entityId].filter(Boolean).join(" / ")}
            </p>
          ) : null}
          {log.url ? <p className="break-all">URL: {log.url}</p> : null}
          {log.metadataJson ? (
            <pre className="overflow-x-auto whitespace-pre-wrap normal-case">
              {log.metadataJson}
            </pre>
          ) : null}
          {log.stack ? (
            <pre className="overflow-x-auto whitespace-pre-wrap normal-case">
              {log.stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
