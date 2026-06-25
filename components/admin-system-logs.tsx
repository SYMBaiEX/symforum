"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs, type SystemLogRecord } from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

type LogStatus = SystemLogRecord["status"];
type LogLevel = SystemLogRecord["level"];
type LogSource = SystemLogRecord["source"];
type LogStatusFilter = LogStatus | "all";
type LogLevelFilter = LogLevel | "all";
type LogSourceFilter = LogSource | "all";
type LogGroupMode = "none" | "source" | "scope";

const statusFilters: LogStatusFilter[] = [
  "open",
  "reviewed",
  "resolved",
  "all",
];
const levelFilters: LogLevelFilter[] = ["all", "error", "warn", "info"];
const sourceFilters: LogSourceFilter[] = [
  "all",
  "client",
  "server",
  "api",
  "convex",
];
const groupModes: LogGroupMode[] = ["none", "source", "scope"];

export function AdminSystemLogs() {
  const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("open");
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<LogSourceFilter>("all");
  const [groupMode, setGroupMode] = useState<LogGroupMode>("source");
  const [query, setQuery] = useState("");
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<LogStatus | null>(null);

  const status = statusFilter === "all" ? undefined : statusFilter;
  const logs = useQuery(convexRefs.admin.listSystemLogs, {
    ...(status ? { status } : {}),
    limit: 80,
  });
  const summary = useQuery(convexRefs.admin.summarySystemLogs, {});
  const updateStatus = useMutation(convexRefs.admin.updateSystemLogStatus);
  const deleteLog = useMutation(convexRefs.admin.deleteSystemLog);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredLogs = useMemo(() => {
    if (!logs) {
      return [];
    }

    return logs.filter((log) => {
      if (levelFilter !== "all" && log.level !== levelFilter) {
        return false;
      }
      if (sourceFilter !== "all" && log.source !== sourceFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      return matchesQuery(log, normalizedQuery);
    });
  }, [levelFilter, logs, normalizedQuery, sourceFilter]);

  const visibleOpenLogs = useMemo(
    () => filteredLogs.filter((log) => log.status === "open"),
    [filteredLogs],
  );
  const visibleErrorCount = useMemo(
    () => filteredLogs.filter((log) => log.level === "error").length,
    [filteredLogs],
  );
  const visibleRepeatingCount = useMemo(
    () => filteredLogs.filter((log) => log.occurrences > 1).length,
    [filteredLogs],
  );
  const groupedLogs = useMemo(
    () => groupLogs(filteredLogs, groupMode),
    [filteredLogs, groupMode],
  );

  async function setStatus(logId: string, nextStatus: LogStatus) {
    setPendingStatusId(logId);
    try {
      await updateStatus({ logId, status: nextStatus });
      toast.success(`Log ${nextStatus}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update log",
      );
    } finally {
      setPendingStatusId(null);
    }
  }

  async function setVisibleStatuses(
    nextStatus: Extract<LogStatus, "reviewed" | "resolved">,
  ) {
    if (visibleOpenLogs.length === 0) {
      return;
    }

    setBulkStatus(nextStatus);
    const results = await Promise.allSettled(
      visibleOpenLogs.map((log) =>
        updateStatus({ logId: log._id, status: nextStatus }),
      ),
    );
    setBulkStatus(null);

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length === 0) {
      toast.success(
        `${nextStatus === "reviewed" ? "Reviewed" : "Resolved"} ${visibleOpenLogs.length} logs`,
      );
      return;
    }

    if (failures.length === results.length) {
      const firstFailure = failures[0];
      toast.error(
        firstFailure &&
          "reason" in firstFailure &&
          firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : `Could not update ${visibleOpenLogs.length} logs`,
      );
      return;
    }

    toast.error(
      `${failures.length} of ${visibleOpenLogs.length} logs failed to update`,
    );
  }

  async function remove(logId: string) {
    if (!window.confirm("Delete this system log?")) {
      return;
    }

    setPendingDeleteId(logId);
    try {
      await deleteLog({ logId });
      toast.success("Log deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete log",
      );
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function copyFingerprint(log: SystemLogRecord) {
    try {
      await navigator.clipboard.writeText(log.fingerprint);
      toast.success("Fingerprint copied");
    } catch {
      toast.error("Could not copy fingerprint");
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
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          80 row window / manual review states
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric
          label="Visible"
          value={filteredLogs.length}
          hint={`${logs?.length ?? 0} in current status view`}
        />
        <Metric
          label="Open"
          value={visibleOpenLogs.length}
          hint="needs triage"
        />
        <Metric
          label="Errors"
          value={visibleErrorCount}
          hint="highest urgency"
        />
        <Metric
          label="Repeating"
          value={visibleRepeatingCount}
          hint="occurrences > 1"
        />
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
        Global sample {summary?.sampleSize.open ?? 0} open /{" "}
        {summary?.sampleSize.reviewed ?? 0} reviewed /{" "}
        {summary?.sampleSize.errors ?? 0} errors /{" "}
        {summary?.sampleSize.warnings ?? 0} warnings
      </p>

      <div className="mt-5 space-y-3 border-y border-row-border py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search visible logs"
              className="h-9 rounded-none border-row-border pl-8 pr-8 font-mono text-[11px] uppercase tracking-normal"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search message, event, path, fingerprint"
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setQuery("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              disabled={visibleOpenLogs.length === 0 || bulkStatus !== null}
              onClick={() => setVisibleStatuses("reviewed")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Eye className="mr-1 h-3.5 w-3.5" />
              {bulkStatus === "reviewed" ? "Reviewing..." : "Review open"}
            </Button>
            <Button
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              disabled={visibleOpenLogs.length === 0 || bulkStatus !== null}
              onClick={() => setVisibleStatuses("resolved")}
              size="sm"
              type="button"
              variant="outline"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {bulkStatus === "resolved" ? "Resolving..." : "Resolve open"}
            </Button>
          </div>
        </div>

        <FilterRow label="Status">
          {statusFilters.map((nextFilter) => (
            <FilterChip
              key={nextFilter}
              active={statusFilter === nextFilter}
              label={nextFilter}
              onClick={() => setStatusFilter(nextFilter)}
            />
          ))}
        </FilterRow>

        <FilterRow label="Level">
          {levelFilters.map((nextFilter) => (
            <FilterChip
              key={nextFilter}
              active={levelFilter === nextFilter}
              label={nextFilter}
              onClick={() => setLevelFilter(nextFilter)}
              tone={nextFilter === "all" ? "default" : nextFilter}
            />
          ))}
        </FilterRow>

        <FilterRow label="Source">
          {sourceFilters.map((nextFilter) => (
            <FilterChip
              key={nextFilter}
              active={sourceFilter === nextFilter}
              label={nextFilter}
              onClick={() => setSourceFilter(nextFilter)}
            />
          ))}
        </FilterRow>

        <FilterRow label="Group">
          {groupModes.map((nextMode) => (
            <FilterChip
              key={nextMode}
              active={groupMode === nextMode}
              label={nextMode === "none" ? "flat" : nextMode}
              onClick={() => setGroupMode(nextMode)}
            />
          ))}
        </FilterRow>
      </div>

      <div className="mt-5">
        {logs === undefined ? (
          <StatusLine>Loading system logs</StatusLine>
        ) : filteredLogs.length === 0 ? (
          <StatusLine>
            {query || levelFilter !== "all" || sourceFilter !== "all"
              ? "No logs match these filters"
              : "No logs in this view"}
          </StatusLine>
        ) : (
          <div className="space-y-5">
            {groupedLogs.map((group) => (
              <section key={group.key} className="space-y-2">
                {groupMode !== "none" ? (
                  <div className="flex flex-wrap items-end justify-between gap-2 border-b border-row-border pb-2">
                    <div>
                      <p className="font-mono text-xs uppercase text-muted-foreground">
                        {group.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {group.logs.length} logs /{" "}
                        {countByStatus(group.logs, "open")} open /{" "}
                        {countByLevel(group.logs, "error")} errors
                      </p>
                    </div>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      {sumOccurrences(group.logs)} total occurrences
                    </p>
                  </div>
                ) : null}

                <div className="divide-y divide-row-border">
                  {group.logs.map((log) => (
                    <SystemLogRow
                      key={log._id}
                      busy={
                        bulkStatus !== null ||
                        pendingStatusId === log._id ||
                        pendingDeleteId === log._id
                      }
                      log={log}
                      onCopyFingerprint={() => copyFingerprint(log)}
                      onDelete={() => remove(log._id)}
                      onResolve={() => setStatus(log._id, "resolved")}
                      onReview={() => setStatus(log._id, "reviewed")}
                      onReopen={() => setStatus(log._id, "open")}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: number;
}) {
  return (
    <div className="border border-row-border px-3 py-2">
      <p className="text-xl font-semibold text-foreground">{value}</p>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function FilterRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-start">
      <p className="w-14 shrink-0 pt-1 font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
  tone = "default",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: LogLevelFilter | "default";
}) {
  return (
    <Button
      className={cn(
        "h-7 rounded-none px-2 font-mono text-[10px] uppercase",
        active
          ? getFilterToneClass(tone)
          : "border-row-border text-muted-foreground",
      )}
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? "default" : "outline"}
    >
      {label}
    </Button>
  );
}

function SystemLogRow({
  busy,
  log,
  onCopyFingerprint,
  onDelete,
  onReopen,
  onResolve,
  onReview,
}: {
  busy: boolean;
  log: SystemLogRecord;
  onCopyFingerprint: () => void;
  onDelete: () => void;
  onReopen: () => void;
  onResolve: () => void;
  onReview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const logHref = getLogHref(log);

  return (
    <article className="py-3">
      <div className="grid gap-3 xl:grid-cols-[9rem_minmax(0,1fr)_auto] xl:items-start">
        <div className="font-mono text-[10px] uppercase text-muted-foreground">
          <p>{formatDate(log.createdAt)}</p>
          <p>
            {log.source} / {log.scope}
          </p>
          {log.requestId ? <p>Request {log.requestId}</p> : null}
          {log.occurrences > 1 ? <p>{log.occurrences} repeats</p> : null}
        </div>

        <button
          aria-controls={`log-details-${log._id}`}
          aria-expanded={expanded}
          className="min-w-0 text-left"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <LevelBadge level={log.level} />
            <StatusBadge status={log.status} />
            {log.statusCode ? <CodeBadge statusCode={log.statusCode} /> : null}
            {log.occurrences > 1 ? (
              <RepeatBadge count={log.occurrences} />
            ) : null}
            <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              {log.eventType}
            </p>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6">{log.message}</p>
          <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
            {[log.method, log.path, log.statusCode].filter(Boolean).join(" / ")}
          </p>
        </button>

        <div className="flex flex-wrap items-center gap-1 xl:justify-end">
          {logHref ? (
            <Button
              asChild
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              size="sm"
              variant="outline"
            >
              <a href={logHref} rel="noreferrer" target="_blank">
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                Open
              </a>
            </Button>
          ) : null}

          {log.status === "open" ? (
            <Button
              aria-label="Mark reviewed"
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              disabled={busy}
              onClick={onReview}
              size="sm"
              type="button"
              variant="outline"
            >
              <Eye className="mr-1 h-3.5 w-3.5" />
              Review
            </Button>
          ) : (
            <Button
              aria-label="Reopen"
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              disabled={busy}
              onClick={onReopen}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reopen
            </Button>
          )}

          {log.status !== "resolved" ? (
            <Button
              aria-label="Resolve"
              className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
              disabled={busy}
              onClick={onResolve}
              size="sm"
              type="button"
              variant="outline"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Resolve
            </Button>
          ) : null}

          <Button
            aria-label="Copy fingerprint"
            className="h-8 rounded-none px-2 font-mono text-[10px] uppercase"
            onClick={onCopyFingerprint}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy id
          </Button>

          <Button
            aria-label="Delete log"
            className="h-8 rounded-none px-2 font-mono text-[10px] uppercase text-destructive"
            disabled={busy}
            onClick={onDelete}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {expanded ? (
        <div
          id={`log-details-${log._id}`}
          className="mt-3 grid gap-2 border-l border-row-border pl-3 font-mono text-[10px] uppercase text-muted-foreground"
        >
          <DetailRow label="Fingerprint" value={log.fingerprint} wrap />
          <DetailRow label="Last seen" value={formatDate(log.lastSeenAt)} />
          {log.component ? (
            <DetailRow label="Component" value={log.component} />
          ) : null}
          {log.action ? <DetailRow label="Action" value={log.action} /> : null}
          {log.name ? <DetailRow label="Name" value={log.name} /> : null}
          {log.sessionId ? (
            <DetailRow label="Session" value={log.sessionId} wrap />
          ) : null}
          {log.actorUserId ? (
            <DetailRow label="Actor" value={log.actorUserId} wrap />
          ) : null}
          {log.entityType || log.entityId ? (
            <DetailRow
              label="Entity"
              value={[log.entityType, log.entityId].filter(Boolean).join(" / ")}
              wrap
            />
          ) : null}
          {log.url ? <DetailRow label="URL" value={log.url} wrap /> : null}
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

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="py-4 font-mono text-xs uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function DetailRow({
  label,
  value,
  wrap = false,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <p className={cn(wrap ? "break-all" : null)}>
      {label}: {value}
    </p>
  );
}

function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none font-mono text-[10px] uppercase",
        level === "error"
          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
          : level === "warn"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-row-border bg-muted/40 text-foreground",
      )}
    >
      {level}
    </Badge>
  );
}

function StatusBadge({ status }: { status: LogStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none font-mono text-[10px] uppercase",
        status === "open"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : status === "reviewed"
            ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {status}
    </Badge>
  );
}

function CodeBadge({ statusCode }: { statusCode: number }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-none font-mono text-[10px] uppercase",
        statusCode >= 500
          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
          : statusCode >= 400
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-row-border text-muted-foreground",
      )}
    >
      {statusCode}
    </Badge>
  );
}

function RepeatBadge({ count }: { count: number }) {
  return (
    <Badge
      variant="outline"
      className="rounded-none border-row-border bg-muted/40 font-mono text-[10px] uppercase text-foreground"
    >
      {count}x
    </Badge>
  );
}

function matchesQuery(log: SystemLogRecord, query: string) {
  return [
    log.message,
    log.eventType,
    log.scope,
    log.source,
    log.component,
    log.action,
    log.path,
    log.url,
    log.fingerprint,
    log.requestId,
    log.sessionId,
    log.entityType,
    log.entityId,
    log.status,
    log.level,
    log.statusCode?.toString(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function groupLogs(logs: SystemLogRecord[], mode: LogGroupMode) {
  if (mode === "none") {
    return [{ key: "all", label: "Current view", logs }];
  }

  const grouped = new Map<string, SystemLogRecord[]>();
  for (const log of logs) {
    const rawKey = mode === "source" ? log.source : log.scope;
    const key = rawKey || "unknown";
    const existing = grouped.get(key);
    if (existing) {
      existing.push(log);
    } else {
      grouped.set(key, [log]);
    }
  }

  return Array.from(grouped.entries())
    .sort((left, right) => right[1].length - left[1].length)
    .map(([key, value]) => ({
      key,
      label: mode === "source" ? `${key} logs` : `${key} scope`,
      logs: value,
    }));
}

function countByStatus(logs: SystemLogRecord[], status: LogStatus) {
  return logs.filter((log) => log.status === status).length;
}

function countByLevel(logs: SystemLogRecord[], level: LogLevel) {
  return logs.filter((log) => log.level === level).length;
}

function sumOccurrences(logs: SystemLogRecord[]) {
  return logs.reduce((sum, log) => sum + log.occurrences, 0);
}

function getFilterToneClass(tone: LogLevelFilter | "default") {
  if (tone === "error") {
    return "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (tone === "warn") {
    return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (tone === "info") {
    return "border-row-border bg-muted/40 text-foreground";
  }
  return "bg-foreground text-background";
}

function getLogHref(log: SystemLogRecord) {
  if (log.path?.startsWith("/")) {
    return log.path;
  }
  if (log.url?.startsWith("http://") || log.url?.startsWith("https://")) {
    return log.url;
  }
  return undefined;
}
