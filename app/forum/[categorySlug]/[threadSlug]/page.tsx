import { resolveForumRouteStatus } from "@/app/forum/forum-route-status";
import { ForumThreadView } from "@/components/forum/forum-thread-view";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { safeForumIsoDate } from "@/lib/forum-metadata";
import { breadcrumbStructuredData } from "@/lib/seo";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ categorySlug: string; threadSlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { categorySlug, threadSlug } = await params;
  const routeStatus = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumRouteStatus({ categorySlug, threadSlug })
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && routeStatus?.exists !== true) {
    notFound();
  }
  const title =
    routeStatus?.kind === "thread"
      ? routeStatus.threadTitle
      : humanizeSlug(threadSlug);
  const description =
    routeStatus?.kind === "thread"
      ? routeStatus.threadExcerpt
      : `Public thread in the ${humanizeSlug(categorySlug)} board.`;
  const canonical = `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}/${encodeURIComponent(threadSlug)}`;
  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      publishedTime:
        routeStatus?.kind === "thread"
          ? safeForumIsoDate(routeStatus.createdAt)
          : undefined,
      modifiedTime:
        routeStatus?.kind === "thread"
          ? safeForumIsoDate(routeStatus.updatedAt)
          : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ForumThreadPage({ params }: PageProps) {
  const { categorySlug, threadSlug } = await params;
  const enabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const routeStatus = enabled
    ? await resolveForumRouteStatus({ categorySlug, threadSlug })
    : null;

  if (enabled && routeStatus?.exists !== true) {
    notFound();
  }
  const title =
    routeStatus?.kind === "thread"
      ? routeStatus.threadTitle
      : humanizeSlug(threadSlug);
  const description =
    routeStatus?.kind === "thread"
      ? routeStatus.threadExcerpt
      : `Public thread in the ${humanizeSlug(categorySlug)} board.`;
  const canonical = `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}/${encodeURIComponent(threadSlug)}`;

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "DiscussionForumPosting",
            headline: title,
            description,
            url: canonical,
            datePublished:
              routeStatus?.kind === "thread"
                ? safeForumIsoDate(routeStatus.createdAt)
                : undefined,
            dateModified:
              routeStatus?.kind === "thread"
                ? safeForumIsoDate(routeStatus.updatedAt)
                : undefined,
            author: { "@type": "Person", name: "SYMBaiEX forum member" },
          },
          breadcrumbStructuredData([
            { name: "Forum", url: "https://forum.symbaiex.com/" },
            {
              name: humanizeSlug(categorySlug),
              url: `https://forum.symbaiex.com/${encodeURIComponent(categorySlug)}`,
            },
            { name: title, url: canonical },
          ]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumThreadView
        categorySlug={categorySlug}
        threadSlug={threadSlug}
        enabled={enabled}
      />
    </section>
  );
}
