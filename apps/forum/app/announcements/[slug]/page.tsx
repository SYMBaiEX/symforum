import {
  forumAnnouncementCanonicalPath,
  resolveForumAnnouncementRouteStatus,
} from "../announcement-route-status";
import { ForumAnnouncementDetailPage } from "@/components/forum/forum-announcement-detail-page";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { safeForumIsoDate } from "@/lib/forum-metadata";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ board?: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { board } = (await searchParams) ?? {};
  const routeStatus = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumAnnouncementRouteStatus({ board, slug })
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && routeStatus === null) {
    notFound();
  }
  const title =
    routeStatus?.title ?? `Forum Announcement / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum announcement or board notice.";
  const canonical = forumSiteUrl(forumAnnouncementCanonicalPath(slug, board));
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
      publishedTime: safeForumIsoDate(routeStatus?.createdAt),
      modifiedTime: safeForumIsoDate(routeStatus?.updatedAt),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ForumAnnouncementDetailRoute({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { board } = (await searchParams) ?? {};
  const announcement = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumAnnouncementRouteStatus({
        board,
        slug,
      })
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    if (announcement === null) {
      notFound();
    }
  }

  const title =
    announcement?.title ?? `Forum Announcement / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum announcement or board notice.";
  const canonical = forumSiteUrl(forumAnnouncementCanonicalPath(slug, board));
  const breadcrumbs = [
    { name: "Forum", url: forumSiteUrl("/") },
    { name: "Announcements", url: forumSiteUrl("/announcements") },
    ...(announcement?.categoryName && announcement.categorySlug
      ? [
          {
            name: announcement.categoryName,
            url: forumSiteUrl(
              `/${encodeURIComponent(announcement.categorySlug)}`,
            ),
          },
        ]
      : []),
    { name: title, url: canonical },
  ];

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "WebPage",
            name: title,
            description,
            url: canonical,
            ...(announcement
              ? {
                  datePublished: safeForumIsoDate(announcement.createdAt),
                  dateModified: safeForumIsoDate(announcement.updatedAt),
                }
              : {}),
          },
          breadcrumbStructuredData(breadcrumbs),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumAnnouncementDetailPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        slug={slug}
      />
    </section>
  );
}
