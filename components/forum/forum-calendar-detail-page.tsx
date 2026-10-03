"use client";

import { ForumPageHeader } from "./forum-layout-primitives";

import {
  FORUM_CALENDAR_TIME_ZONE,
  formatForumDateTime,
  forumRefs,
  type ForumCalendarEventRecord,
} from "@/components/forum/forum-refs";
import {
  ForumBody,
  ForumLink,
  ForumLoading,
  ForumStatusBox,
} from "@/components/forum/forum-primitives";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex-helpers/react/cache/hooks";

export function ForumCalendarDetailPage({
  enabled,
  slug,
}: {
  enabled: boolean;
  slug: string;
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

  return <LiveForumCalendarDetailPage slug={slug} />;
}

function LiveForumCalendarDetailPage({ slug }: { slug: string }) {
  const event = useQuery(forumRefs.getCalendarEvent, { slug });

  if (event === undefined) {
    return <ForumLoading label="Opening calendar event" />;
  }

  if (event === null) {
    return (
      <ForumStatusBox
        title="Calendar event not found"
        body="That event is no longer active on the forum calendar."
        action={
          <Button asChild className="rounded-xl text-xs" variant="outline">
            <ForumLink href="/forum/calendar" prefetch>
              Calendar
            </ForumLink>
          </Button>
        }
      />
    );
  }

  return (
    <article className="space-y-3">
      <ForumPageHeader
        title={event.title}
        description={formatCalendarEventRange(event)}
      />

      <div className="max-w-3xl rounded-xl bg-muted/25 p-4 sm:p-6">
        <ForumBody body={event.body} />
      </div>

      <Button asChild className="rounded-xl text-xs" variant="outline">
        <ForumLink href={`/forum/calendar?month=${event.month}`} prefetch>
          Calendar
        </ForumLink>
      </Button>
    </article>
  );
}

function formatCalendarEventRange(event: ForumCalendarEventRecord) {
  if (event.allDay) {
    return `${formatCalendarDate(event.startsAt)} / All day`;
  }
  if (event.endsAt === undefined) {
    return formatCalendarDateTime(event.startsAt);
  }
  return `${formatCalendarDateTime(event.startsAt)} to ${formatCalendarDateTime(
    event.endsAt,
  )}`;
}

function formatCalendarDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
  }).format(new Date(timestamp));
}

function formatCalendarDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: FORUM_CALENDAR_TIME_ZONE,
  }).format(new Date(timestamp));
}
