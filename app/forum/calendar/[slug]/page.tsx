import { ForumCalendarDetailPage } from "@/components/forum/forum-calendar-detail-page";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { convexRefs } from "@/lib/convex-refs";
import { getServerConvexClient } from "@/lib/server-convex";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

const FORUM_CALENDAR_EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = normalizeCalendarEventSlugParam(rawSlug) ?? rawSlug;
  return {
    title: `Forum Calendar / ${humanizeSlug(slug)}`,
    description: "A SYMBaiEX forum calendar event.",
    alternates: {
      canonical: `https://forum.symbaiex.com/calendar/${encodeURIComponent(
        slug,
      )}`,
    },
  };
}

export default async function ForumCalendarDetailRoute({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const slug = normalizeCalendarEventSlugParam(rawSlug);
  if (slug === null) {
    notFound();
  }

  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    const event = await resolveForumCalendarEvent(slug);
    if (event === null) {
      notFound();
    }
  }

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-3" />
      <ForumCalendarDetailPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        slug={slug}
      />
    </section>
  );
}

function normalizeCalendarEventSlugParam(value: string) {
  const slug = value.trim().toLowerCase();
  if (slug !== value || !FORUM_CALENDAR_EVENT_SLUG_PATTERN.test(slug)) {
    return null;
  }
  return slug;
}

async function resolveForumCalendarEvent(slug: string) {
  const convex = getServerConvexClient();
  if (!convex) {
    return undefined;
  }

  try {
    return await convex.query(convexRefs.forum.getCalendarEvent, { slug });
  } catch {
    return undefined;
  }
}
