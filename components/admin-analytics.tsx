"use client";

import { Button } from "@/components/ui/button";
import { convexRefs, type AnalyticsEventRecord } from "@/lib/convex-refs";
import { compactNumber, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Activity, BarChart3, ExternalLink, MousePointer2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

const windows = [7, 14, 30, 90] as const;

export function AdminAnalytics() {
  const [days, setDays] = useState<(typeof windows)[number]>(14);
  const summary = useQuery(convexRefs.admin.analyticsSummary, { days });
  const events = useQuery(convexRefs.admin.analyticsEvents, { limit: 60 });
  const maxDaily = useMemo(
    () =>
      Math.max(
        1,
        ...(summary?.daily.map((row) => Math.max(row.events, row.pageViews)) ??
          []),
      ),
    [summary],
  );
  const openPanelEnabled = Boolean(process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID);

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
                "h-7 px-2 font-mono text-[10px] uppercase",
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

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Metric
          icon={<Activity />}
          label="Events"
          value={summary?.totals.events ?? 0}
        />
        <Metric
          icon={<MousePointer2 />}
          label="Page views"
          value={summary?.totals.pageViews ?? 0}
        />
        <Metric
          icon={<BarChart3 />}
          label="Visitors"
          value={summary?.totals.visitors ?? 0}
        />
        <Metric
          icon={<ExternalLink />}
          label="Sessions"
          value={summary?.totals.sessions ?? 0}
        />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Daily volume
          </p>
          <div className="mt-4 grid gap-2">
            {summary?.daily.map((row) => (
              <div
                key={row.date}
                className="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-3"
              >
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {row.date.slice(5)}
                </p>
                <div className="h-2 bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.max(2, (row.events / maxDaily) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-right font-mono text-[10px] uppercase text-muted-foreground">
                  {row.events}
                </p>
              </div>
            ))}
            {summary === undefined ? <StatusLine>Loading analytics</StatusLine> : null}
          </div>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Native Convex analytics are always on. OpenPanel is{" "}
            {openPanelEnabled ? "configured" : "ready but not configured"} and
            proxied through <code className="font-mono">/api/op</code> when a
            client id is present.
          </p>
        </div>

        <div className="grid gap-6 lg:col-span-4">
          <RankedList title="Top pages" rows={summary?.topPages} />
          <RankedList title="Top events" rows={summary?.topEvents} />
        </div>

        <div className="grid gap-6 lg:col-span-3">
          <RankedList title="Referrers" rows={summary?.referrers} />
          <RankedList title="Sources" rows={summary?.sources} />
        </div>
      </div>

      <div className="mt-8">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Recent stream
        </p>
        <div className="mt-3 grid gap-1">
          {(events ?? []).map((event) => (
            <EventRow event={event} key={event._id} />
          ))}
          {events === undefined ? <StatusLine>Loading event stream</StatusLine> : null}
          {events?.length === 0 ? <StatusLine>No events recorded yet</StatusLine> : null}
        </div>
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-end justify-between gap-3 py-2">
      <div>
        <p className="text-3xl font-semibold leading-none">
          {compactNumber(value)}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="text-muted-foreground [&_svg]:size-4">{icon}</div>
    </div>
  );
}

function RankedList({
  title,
  rows,
}: {
  title: string;
  rows?: Array<{ key: string; count: number }>;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">
        {title}
      </p>
      <div className="mt-3 grid gap-2">
        {(rows ?? []).map((row) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"
            key={row.key}
          >
            <p className="truncate text-sm">{row.key}</p>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {row.count}
            </p>
          </div>
        ))}
        {rows === undefined ? <StatusLine>Loading</StatusLine> : null}
        {rows?.length === 0 ? <StatusLine>No data</StatusLine> : null}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: AnalyticsEventRecord }) {
  return (
    <article className="grid gap-2 py-2 md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-center">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {formatDate(event.createdAt)}
      </p>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{event.name}</p>
        <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
          {[event.path, event.title].filter(Boolean).join(" / ")}
        </p>
      </div>
      <p className="font-mono text-[10px] uppercase text-muted-foreground">
        {event.source}
      </p>
    </article>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="py-2 font-mono text-[10px] uppercase text-muted-foreground">
      {children}
    </p>
  );
}
