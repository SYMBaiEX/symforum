"use client";

import {
  FORUM_CALENDAR_TIME_ZONE,
  adjacentForumCalendarMonth,
  forumCalendarEventPath,
  forumCalendarMonthLabel,
  forumRefs,
  type ForumCalendarEventSummaryRecord,
} from "@/components/forum/forum-refs";
import {
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useMemo } from "react";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ForumCalendarPage({
  enabled,
  month,
}: {
  enabled: boolean;
  month: string;
}) {
  if (!enabled) {
    return (
      <ForumStatusBox
        title="Calendar unavailable"
        body="Convex is not configured in this checkout, so forum calendar events cannot load."
        accent="cyan"
      />
    );
  }

  return <LiveForumCalendarPage month={month} />;
}

function LiveForumCalendarPage({ month }: { month: string }) {
  const events = useQuery(forumRefs.listCalendarEvents, { month });
  const calendar = useMemo(
    () => buildCalendarMonth(month, events ?? []),
    [events, month],
  );
  const previousMonth = adjacentForumCalendarMonth(month, -1);
  const nextMonth = adjacentForumCalendarMonth(month, 1);

  if (events === undefined) {
    return <ForumLoading label="Syncing calendar" />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-sm bg-background py-2">
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold md:text-2xl">
              {forumCalendarMonthLabel(month)}
            </h2>
          </div>
          <div className="flex gap-2">
            <Button
              asChild={previousMonth !== null}
              className="h-7 rounded-sm px-2 text-xs"
              disabled={previousMonth === null}
              size="sm"
              variant="outline"
            >
              {previousMonth === null ? (
                <span>Prev</span>
              ) : (
                <ForumLink
                  href={`/forum/calendar?month=${previousMonth}`}
                  prefetch
                >
                  Prev
                </ForumLink>
              )}
            </Button>
            <Button
              asChild={nextMonth !== null}
              className="h-7 rounded-sm px-2 text-xs"
              disabled={nextMonth === null}
              size="sm"
              variant="outline"
            >
              {nextMonth === null ? (
                <span>Next</span>
              ) : (
                <ForumLink href={`/forum/calendar?month=${nextMonth}`} prefetch>
                  Next
                </ForumLink>
              )}
            </Button>
          </div>
        </div>
      </div>

      <section className="min-w-0 rounded-sm bg-background">
        <div className="md:hidden">
          <div className="grid grid-cols-7 bg-muted/35 text-center text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div aria-label={label} className="px-1 py-2" key={label}>
                {label.slice(0, 1)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendar.days.map((day) => (
              <div
                className={cn(
                  "min-h-14 min-w-0 rounded-sm bg-muted/35 p-1.5",
                  !day.inMonth && "bg-muted/20 text-muted-foreground",
                )}
                key={day.key}
              >
                <p className="text-xs">{day.dayNumber}</p>
                {day.events.length > 0 ? (
                  <span
                    aria-label={`${day.events.length} ${
                      day.events.length === 1 ? "event" : "events"
                    }`}
                    className="mt-1 inline-flex min-w-5 items-center justify-center rounded-sm bg-primary/10 px-1 text-xs font-medium text-primary"
                  >
                    {day.events.length}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="hidden md:block">
          <div className="grid grid-cols-7 bg-muted/35 text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div className="px-2 py-2" key={label}>
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendar.days.map((day) => (
              <div
                className={cn(
                  "min-h-24 min-w-0 rounded-sm bg-muted/35 p-2",
                  !day.inMonth && "bg-muted/20 text-muted-foreground",
                )}
                key={day.key}
              >
                <p className="text-xs">{day.dayNumber}</p>
                <div className="mt-2 space-y-1">
                  {day.events.slice(0, 3).map((event) => (
                    <ForumLink
                      className="focus-ring block truncate rounded-sm bg-primary/10 px-1.5 py-2 text-xs text-primary hover:bg-primary/15"
                      href={forumCalendarEventPath(event)}
                      key={event._id}
                      prefetch
                    >
                      {event.title}
                    </ForumLink>
                  ))}
                  {day.events.length > 3 ? (
                    <p className="text-xs text-muted-foreground">
                      +{day.events.length - 3} more
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {events.length === 0 ? (
        <ForumStatusBox
          title="No calendar events"
          body="This month has no active forum events yet."
        />
      ) : (
        <section className="min-w-0 rounded-sm bg-background">
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
            <span>Date</span>
            <span>Event</span>
          </div>
          <div className="space-y-1">
            {events.map((event) => (
              <article
                className="forum-list-row grid min-w-0 gap-2 px-3 py-3 md:grid-cols-[8rem_minmax(0,1fr)_auto]"
                key={event._id}
              >
                <div className="text-xs text-muted-foreground">
                  <p>{formatCalendarDay(event.day)}</p>
                  <p>{formatCalendarTime(event)}</p>
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">
                    <ForumLink href={forumCalendarEventPath(event)} prefetch>
                      {event.title}
                    </ForumLink>
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {event.excerpt}
                  </p>
                </div>
                <Button
                  asChild
                  className="h-7 rounded-sm px-2 text-xs"
                  size="sm"
                  variant="outline"
                >
                  <ForumLink href={forumCalendarEventPath(event)} prefetch>
                    Open
                  </ForumLink>
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function buildCalendarMonth(
  month: string,
  events: ForumCalendarEventSummaryRecord[],
) {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const leadingDays = first.getUTCDay();
  const eventsByDay = new Map<string, ForumCalendarEventSummaryRecord[]>();
  for (const event of events) {
    const dayEvents = eventsByDay.get(event.day) ?? [];
    dayEvents.push(event);
    eventsByDay.set(event.day, dayEvents);
  }

  const cells: Array<{
    key: string;
    dayNumber: number;
    inMonth: boolean;
    events: ForumCalendarEventSummaryRecord[];
  }> = [];
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - leadingDays + 1;
    const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
    const date = new Date(Date.UTC(year, monthIndex, dayNumber));
    const key = date.toISOString().slice(0, 10);
    cells.push({
      key,
      dayNumber: date.getUTCDate(),
      inMonth,
      events: inMonth ? (eventsByDay.get(key) ?? []) : [],
    });
  }

  return { days: cells };
}

function formatCalendarDay(day: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));
}

function formatCalendarTime(event: ForumCalendarEventSummaryRecord) {
  if (event.allDay) {
    return "All day";
  }
  const start = formatTime(event.startsAt);
  return event.endsAt === undefined
    ? start
    : `${start}-${formatTime(event.endsAt)}`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
  }).format(new Date(timestamp));
}
