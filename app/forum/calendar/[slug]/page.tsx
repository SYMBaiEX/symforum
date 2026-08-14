import { ForumCalendarDetailPage } from "@/components/forum/forum-calendar-detail-page";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { convexRefs } from "@/lib/convex-refs";
import { safeForumIsoDate } from "@/lib/forum-metadata";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";
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
  const event = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumCalendarEvent(slug)
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && event === null) {
    notFound();
  }
  const title = event?.title ?? `Forum Calendar / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum calendar event.";
  const canonical = forumSiteUrl(`/calendar/${encodeURIComponent(slug)}`);
  return {
    title: { absolute: compactSeoTitle(title, "SYMBaiEX forum") },
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      publishedTime: safeForumIsoDate(event?.createdAt),
      modifiedTime: safeForumIsoDate(event?.updatedAt),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ForumCalendarDetailRoute({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const slug = normalizeCalendarEventSlugParam(rawSlug);
  if (slug === null) {
    notFound();
  }

  const event = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumCalendarEvent(slug)
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    if (event === null) {
      notFound();
    }
  }

  const title = event?.title ?? `Forum Calendar / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum calendar event.";
  const canonical = forumSiteUrl(`/calendar/${encodeURIComponent(slug)}`);

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "WebPage",
            name: title,
            description,
            url: canonical,
            ...(event
              ? {
                  datePublished: safeForumIsoDate(event.createdAt),
                  dateModified: safeForumIsoDate(event.updatedAt),
                }
              : {}),
          },
          breadcrumbStructuredData([
            { name: "Forum", url: forumSiteUrl("/") },
            { name: "Calendar", url: forumSiteUrl("/calendar") },
            { name: title, url: canonical },
          ]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
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
