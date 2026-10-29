
import { FORUM_SITE_URL } from "../../../../lib/site-urls";
import { ForumCalendarPage } from "@/components/forum/forum-calendar-page";
import { normalizeForumCalendarMonthParam } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { forumCollectionStructuredData } from "@/lib/seo";
import type { Metadata } from "next";

type PageProps = {
  searchParams?: Promise<{ month?: string }>;
};

export const metadata: Metadata = {
  title: "Forum Calendar",
  description: "Calendar events for the SYMBaiEX forum.",
  alternates: {
    canonical: FORUM_SITE_URL + "/calendar",
  },
};

export default async function ForumCalendarRoute({ searchParams }: PageProps) {
  const { month: rawMonth } = (await searchParams) ?? {};
  const month = normalizeForumCalendarMonthParam(rawMonth);

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Calendar",
          "Calendar events for the SYMBaiEX forum.",
          "/calendar",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Forum calendar</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">Calendar</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          Community events, meetups, publishing windows, and forum reminders.
        </p>
      </header>
      <ForumCalendarPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        month={month}
      />
    </section>
  );
}
