import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
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
    canonical: "https://forum.symbaiex.com/calendar",
  },
};

export default async function ForumCalendarRoute({ searchParams }: PageProps) {
  const { month: rawMonth } = (await searchParams) ?? {};
  const month = normalizeForumCalendarMonthParam(rawMonth);

  return (
    <section className="page-frame page-frame-dense forum-workspace space-y-4">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Calendar",
          "Calendar events for the SYMBaiEX forum.",
          "/calendar",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumPageHeader
        title="Calendar"
        description="Community events, meetups, and reminders."
      />
      <ForumCalendarPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        month={month}
      />
    </section>
  );
}
