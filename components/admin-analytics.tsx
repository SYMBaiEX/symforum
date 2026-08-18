"use client";

import { Button } from "@/components/ui/button";
import {
  convexRefs,
  type AnalyticsEventRecord,
  type AnalyticsSource,
} from "@/lib/convex-refs";
import { compactNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  Activity,
  BarChart3,
  ExternalLink,
  Eye,
  MousePointer2,
  ScanSearch,
  UserRound,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

const windows = [7, 14, 30, 90] as const;
const eventFilterLimit = 6;
const streamLimit = 100;

type WindowDays = (typeof windows)[number];
type EventSourceFilter = AnalyticsSource | "all";

export function AdminAnalytics() {
  const [queryNow] = useState(() => Date.now());
  const [days, setDays] = useState<WindowDays>(14);
  const [sourceFilter, setSourceFilter] = useState<EventSourceFilter>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [searchValue, setSearchValue] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const summary = useQuery(convexRefs.admin.analyticsSummary, {
    days,
    now: queryNow,
  });
  const events = useQuery(convexRefs.admin.analyticsEvents, {
    ...(eventFilter !== "all" ? { name: eventFilter } : {}),
    ...(sourceFilter !== "all" ? { source: sourceFilter } : {}),
    limit: streamLimit,
  });

  const maxDaily = useMemo(
    () =>
      Math.max(
        1,
        ...(summary?.daily.map((row) => Math.max(row.events, row.pageViews)) ??
          []),
      ),
    [summary],
  );

  const searchTerm = searchValue.trim().toLowerCase();
  const filteredEvents = useMemo(() => {
    if (!events) {
      return [];
    }
    if (!searchTerm) {
      return events;
    }
    return events.filter((event) =>
      [
        event.name,
        event.path,
        event.route,
        event.title,
        event.referrer,
        event.source,
        event.device,
        event.sessionId,
        event.visitorId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(searchTerm),
    );
  }, [events, searchTerm]);

  const activeEvent =
    filteredEvents.find((event) => event._id === selectedEventId) ??
    filteredEvents[0] ??
    null;

  const topSource = summary?.sources[0];
  const leadReferrer = summary?.referrers[0];
  const leadPage = summary?.topPages[0];
  const avgEventsPerDay = summary
    ? summary.totals.events / Math.max(summary.windowDays, 1)
    : 0;
  const avgSessionDepth = summary
    ? summary.totals.events / Math.max(summary.totals.sessions, 1)
    : 0;
  const signedInRate = summary
    ? summary.totals.signedInEvents / Math.max(summary.totals.events, 1)
    : 0;
  const pageViewRate = summary
    ? summary.totals.pageViews / Math.max(summary.totals.events, 1)
    : 0;
  const recentEventNames = summary?.topEvents.slice(0, eventFilterLimit) ?? [];
  const sourceOptions = summary?.sources.map((row) => row.key) ?? [];
  const recentCoverage = filteredEvents.length;

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Analytics
          </p>
          <h2 className="mt-1 text-2xl font-semibold">Signal desk</h2>
        </div>
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase">
          {windows.map((windowDays) => (
            <Button
              key={windowDays}
              className={cn(
                "h-7 rounded-none px-2 font-mono text-[10px] uppercase",
                days === windowDays ? "bg-foreground text-background" : null,
              )}
              onClick={() => setDays(windowDays)}
              size="sm"
              type="button"
              variant={days === windowDays ? "default" : "outline"}
            >
              {windowDays}d
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Metric
          icon={<Activity />}
          label="Events"
          note={`${compactNumber(avgEventsPerDay)} / day`}
          value={summary?.totals.events ?? 0}
        />
        <Metric
          icon={<MousePointer2 />}
          label="Page views"
          note={`${formatPercent(pageViewRate)} of stream`}
          value={summary?.totals.pageViews ?? 0}
        />
        <Metric
          icon={<BarChart3 />}
          label="Visitors"
          note={`${compactNumber(summary?.sampleSize)} sampled`}
          value={summary?.totals.visitors ?? 0}
        />
        <Metric
          icon={<ExternalLink />}
          label="Sessions"
          note={`${avgSessionDepth.toFixed(1)} events / session`}
          value={summary?.totals.sessions ?? 0}
        />
        <Metric
          icon={<UserRound />}
          label="Signed in"
          note={`${formatPercent(signedInRate)} identified`}
          value={summary?.totals.signedInEvents ?? 0}
        />
        <Metric
          icon={<Eye />}
          label="Today"
          note={`${days}d live window`}
          value={summary?.totals.todayEvents ?? 0}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-12">
        <section className="border-y border-row-border py-4 lg:col-span-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Daily volume
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Events and page views across the active window.
              </p>
            </div>
            {summary?.daily.length ? (
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Peak {compactNumber(maxDaily)}
              </p>
            ) : null}
          </div>
          <div className="mt-4 grid gap-2">
            {summary?.daily.map((row) => (
              <div
                key={row.date}
                className="grid grid-cols-[4.25rem_minmax(0,1fr)_3rem] items-center gap-3"
              >
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {row.date.slice(5)}
                </p>
                <div className="space-y-1">
                  <div className="h-2 bg-muted">
                    <div
                      className="h-full bg-foreground"
                      style={{
                        width: `${Math.max(2, (row.events / maxDaily) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="h-1 bg-muted/60">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.max(2, (row.pageViews / maxDaily) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="text-right font-mono text-[10px] uppercase text-muted-foreground">
                  {row.events}
                </p>
              </div>
            ))}
            {summary === undefined ? (
              <StatusLine>Loading analytics</StatusLine>
            ) : null}
            {summary?.daily.length === 0 ? (
              <StatusLine>No daily activity in this window</StatusLine>
            ) : null}
          </div>
          <div className="mt-4 grid gap-2 border-l border-row-border pl-3 font-mono text-[10px] uppercase text-muted-foreground">
            <p>Event bars use black; page-view bars use accent.</p>
            <p>{compactNumber(avgEventsPerDay)} average events per day.</p>
            <p>
              {topSource
                ? `${topSource.key} leads source mix.`
                : "Source mix will appear after traffic lands."}
            </p>
          </div>
        </section>

        <section className="border-y border-row-border py-4 lg:col-span-4">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Traffic mix
          </p>
          <div className="mt-4 grid gap-4">
            <InsightBlock
              label="Lead page"
              value={leadPage?.key ?? "No page data yet"}
              note={
                leadPage
                  ? `${compactNumber(leadPage.count)} views in window`
                  : "Top pages will populate once page views are tracked."
              }
            />
            <InsightBlock
              label="Top referrer"
              value={leadReferrer?.key ?? "Direct / unknown"}
              note={
                leadReferrer
                  ? `${compactNumber(leadReferrer.count)} handoffs`
                  : "No referrer data recorded yet."
              }
            />
            <div className="grid gap-2">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                Source share
              </p>
              {(summary?.sources ?? []).map((row) => (
                <BarRow
                  key={row.key}
                  count={row.count}
                  label={row.key}
                  total={summary?.totals.events ?? 0}
                />
              ))}
              {summary?.sources.length === 0 ? (
                <StatusLine>No source mix yet</StatusLine>
              ) : null}
            </div>
          </div>
        </section>

        <section className="border-y border-row-border py-4 lg:col-span-3">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Ranked slices
          </p>
          <div className="mt-4 grid gap-5">
            <RankedList
              rows={summary?.topPages}
              title="Top pages"
              total={summary?.totals.pageViews ?? 0}
            />
            <RankedList
              rows={summary?.topEvents}
              title="Top events"
              total={summary?.totals.events ?? 0}
            />
            <RankedList
              rows={summary?.referrers}
              title="Referrers"
              total={summary?.totals.events ?? 0}
            />
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-12">
        <section className="border-y border-row-border py-4 lg:col-span-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Operating read
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Derived ratios from the current window.
              </p>
            </div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {days} day scope
            </p>
          </div>
          <div className="mt-4 grid gap-3">
            <SignalRow
              label="Daily cadence"
              note={`${compactNumber(summary?.totals.todayEvents)} today`}
              value={`${compactNumber(avgEventsPerDay)} / day`}
            />
            <SignalRow
              label="Session depth"
              note={`${compactNumber(summary?.totals.sessions)} sessions`}
              value={`${avgSessionDepth.toFixed(1)} events`}
            />
            <SignalRow
              label="Signed-in share"
              note={`${compactNumber(summary?.totals.signedInEvents)} attributed`}
              value={formatPercent(signedInRate)}
            />
            <SignalRow
              label="Visible coverage"
              note={`${recentCoverage} stream rows after filters`}
              value={`${compactNumber(summary?.sampleSize)} sampled`}
            />
          </div>
        </section>

        <section className="border-y border-row-border py-4 lg:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Stream controls
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Filter the recent event stream without leaving the admin tab.
              </p>
            </div>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">
              {events === undefined
                ? "Loading stream"
                : `${filteredEvents.length} visible / ${events.length} fetched`}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap gap-1">
              <FilterButton
                active={sourceFilter === "all"}
                label="All sources"
                onClick={() => setSourceFilter("all")}
              />
              {sourceOptions.map((source) => (
                <FilterButton
                  key={source}
                  active={sourceFilter === source}
                  label={source}
                  onClick={() => setSourceFilter(source)}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-1">
              <FilterButton
                active={eventFilter === "all"}
                label="All events"
                onClick={() => setEventFilter("all")}
              />
              {recentEventNames.map((row) => (
                <FilterButton
                  key={row.key}
                  active={eventFilter === row.key}
                  label={row.key}
                  onClick={() => setEventFilter(row.key)}
                />
              ))}
            </div>

            <label className="grid gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Search path, title, referrer, or device
              </span>
              <div className="flex items-center gap-2 border border-row-border px-2">
                <ScanSearch className="size-3.5 text-muted-foreground" />
                <input
                  className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search the visible stream"
                  type="search"
                  value={searchValue}
                />
              </div>
            </label>
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Recent stream
          </p>
          <div className="mt-3 divide-y divide-row-border border-y border-row-border">
            {events === undefined ? (
              <StatusLine>Loading event stream</StatusLine>
            ) : filteredEvents.length === 0 ? (
              <StatusLine>No events in this filtered view</StatusLine>
            ) : (
              filteredEvents.map((event) => (
                <EventRow
                  active={activeEvent?._id === event._id}
                  event={event}
                  key={event._id}
                  onSelect={() => setSelectedEventId(event._id)}
                />
              ))
            )}
          </div>
        </section>

        <section className="lg:col-span-5">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Event inspector
          </p>
          <div className="mt-3 border-y border-row-border py-4">
            {activeEvent ? (
              <EventInspector event={activeEvent} />
            ) : (
              <StatusLine>Select an event to inspect metadata</StatusLine>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  note,
  value,
}: {
  icon: ReactNode;
  label: string;
  note: string;
  value: number;
}) {
  return (
    <div className="border border-row-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold leading-none">
            {compactNumber(value)}
          </p>
          <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
        <div className="text-muted-foreground [&_svg]:size-4">{icon}</div>
      </div>
    </div>
  );
}

function InsightBlock({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="border border-row-border p-3">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function BarRow({
  count,
  label,
  total,
}: {
  count: number;
  label: string;
  total: number;
}) {
  const width = total > 0 ? Math.max(6, (count / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm">{label}</p>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            {formatPercent(count / Math.max(total, 1))}
          </p>
        </div>
        <div className="mt-2 h-2 bg-muted">
          <div className="h-full bg-primary" style={{ width: `${width}%` }} />
        </div>
      </div>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {compactNumber(count)}
      </p>
    </div>
  );
}

function RankedList({
  title,
  rows,
  total,
}: {
  title: string;
  rows?: Array<{ key: string; count: number }>;
  total: number;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">
        {title}
      </p>
      <div className="mt-3 grid gap-2">
        {(rows ?? []).map((row) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-row-border pb-2"
            key={row.key}
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{row.key}</p>
              <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">
                {formatPercent(row.count / Math.max(total, 1))}
              </p>
            </div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {compactNumber(row.count)}
            </p>
          </div>
        ))}
        {rows === undefined ? <StatusLine>Loading</StatusLine> : null}
        {rows?.length === 0 ? <StatusLine>No data</StatusLine> : null}
      </div>
    </div>
  );
}

function SignalRow({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-row-border pb-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </div>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {value}
      </p>
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "h-7 rounded-none px-2 font-mono text-[10px] uppercase shadow-none",
        active ? "bg-foreground text-background" : null,
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

function EventRow({
  active,
  event,
  onSelect,
}: {
  active: boolean;
  event: AnalyticsEventRecord;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "grid w-full gap-2 px-0 py-3 text-left md:grid-cols-[8rem_minmax(0,1fr)_auto] md:items-center",
        active ? "bg-muted/35" : null,
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="font-mono text-[10px] uppercase text-muted-foreground">
        <p>{formatDate(event.createdAt)}</p>
        <p>{event.source}</p>
      </div>
      <div className="min-w-0 px-3">
        <p className="truncate text-sm font-semibold">{event.name}</p>
        <p className="mt-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
          {formatEventLocation(event)}
        </p>
      </div>
      <div className="px-3 font-mono text-[10px] uppercase text-muted-foreground md:px-0">
        <p>{event.device ?? "unknown device"}</p>
        <p>{formatEventTime(event.createdAt)}</p>
      </div>
    </button>
  );
}

function EventInspector({ event }: { event: AnalyticsEventRecord }) {
  const metadata = formatMetadata(event.metadataJson);

  return (
    <article className="grid gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-row-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
            {event.source}
          </span>
          {event.device ? (
            <span className="border border-row-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
              {event.device}
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 text-lg font-semibold">{event.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatEventLocation(event)}
        </p>
      </div>

      <div className="grid gap-2 border-l border-row-border pl-3">
        <InspectorField label="Observed" value={formatDate(event.createdAt)} />
        <InspectorField
          label="Clock"
          value={formatEventTime(event.createdAt)}
        />
        <InspectorField label="Session" value={event.sessionId} />
        <InspectorField label="Visitor" value={event.visitorId} />
        <InspectorField label="Referrer" value={event.referrer} />
        <InspectorField label="Route" value={event.route} />
        <InspectorField label="Actor" value={event.actorUserId} />
        <InspectorField label="Title" value={event.title} />
        <InspectorField label="User agent" value={event.userAgent} />
      </div>

      {metadata ? (
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Metadata
          </p>
          <pre className="mt-2 overflow-x-auto border border-row-border p-3 text-xs leading-6 text-muted-foreground">
            {metadata}
          </pre>
        </div>
      ) : (
        <StatusLine>No metadata on this event</StatusLine>
      )}
    </article>
  );
}

function InspectorField({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="grid gap-1">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      <p className="break-all text-sm">{value}</p>
    </div>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="py-2 font-mono text-[10px] uppercase text-muted-foreground">
      {children}
    </p>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatEventLocation(event: AnalyticsEventRecord) {
  return (
    [event.path, event.route, event.title].filter(Boolean).join(" / ") ||
    "No path captured"
  );
}

function formatEventTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMetadata(metadataJson?: string) {
  if (!metadataJson) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(metadataJson), null, 2);
  } catch {
    return metadataJson;
  }
}
