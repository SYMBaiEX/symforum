import { ForumCalendarPage } from "@/components/forum/forum-calendar-page";
import { normalizeForumCalendarMonthParam } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

type PageProps = {
  searchParams?: Promise<{ month?: string }>;
};

export const metadata: Metadata = {
  title: "Forum Calendar",
  description: "Calendar events for the SYMBiEX forum.",
  alternates: {
    canonical: "https://forum.symbaiex.com/calendar",
  },
};

export default async function ForumCalendarRoute({ searchParams }: PageProps) {
  const { month: rawMonth } = (await searchParams) ?? {};
  const month = normalizeForumCalendarMonthParam(rawMonth);

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-5" />
      <ForumCalendarPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        month={month}
      />
    </section>
  );
}
