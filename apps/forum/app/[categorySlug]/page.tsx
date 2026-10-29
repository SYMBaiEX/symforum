
import { FORUM_SITE_URL } from "../../../../lib/site-urls";
import { resolveForumRouteStatus } from "../forum-route-status";
import { ForumThreadList } from "@/components/forum/forum-thread-list";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData, compactSeoTitle } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";
import { PRIMARY_SITE_URL } from "@/lib/site-urls";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ categorySlug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { categorySlug } = await params;
  const routeStatus = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumRouteStatus({ categorySlug })
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && routeStatus?.exists !== true) {
    notFound();
  }
  const categoryName =
    routeStatus?.kind === "category"
      ? routeStatus.categoryName
      : humanizeSlug(categorySlug);
  const description =
    routeStatus?.kind === "category"
      ? routeStatus.categoryDescription
      : `Public thread list for the ${categoryName} board.`;
  const canonical = `${FORUM_SITE_URL}/${encodeURIComponent(categorySlug)}`;
  return {
    title: { absolute: compactSeoTitle(categoryName, "SYMBaiEX forum") },
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: categoryName,
      description,
      type: "website",
      url: canonical,
      images: [
        {
          url: `${PRIMARY_SITE_URL}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `SYMBaiEX forum board: ${categoryName}`,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: categoryName,
      description,
      images: [`${PRIMARY_SITE_URL}/opengraph-image`],
    },
  };
}

export default async function ForumCategoryPage({ params }: PageProps) {
  const { categorySlug } = await params;
  const enabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const routeStatus = enabled
    ? await resolveForumRouteStatus({ categorySlug })
    : null;

  if (enabled && routeStatus?.exists !== true) {
    notFound();
  }
  const categoryName =
    routeStatus?.kind === "category"
      ? routeStatus.categoryName
      : humanizeSlug(categorySlug);
  const description =
    routeStatus?.kind === "category"
      ? routeStatus.categoryDescription
      : `Public thread list for the ${categoryName} board.`;
  const canonical = `${FORUM_SITE_URL}/${encodeURIComponent(categorySlug)}`;

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "CollectionPage",
            name: categoryName,
            description,
            url: canonical,
            isPartOf: {
              "@type": "WebSite",
              name: "SYMBaiEX forum",
              url: forumSiteUrl("/"),
            },
          },
          breadcrumbStructuredData([
            { name: "Forum", url: forumSiteUrl("/") },
            { name: categoryName, url: canonical },
          ]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Public board</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">
          {categoryName}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <ForumThreadList categorySlug={categorySlug} enabled={enabled} />
    </section>
  );
}
