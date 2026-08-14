import { ForumHelpDetailPage } from "@/components/forum/forum-help-detail-page";
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

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumHelpDocument(slug)
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL && document === null) {
    notFound();
  }
  const title = document?.title ?? `Forum Help / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum help or FAQ document.";
  const canonical = forumSiteUrl(`/help/${encodeURIComponent(slug)}`);
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
      publishedTime: safeForumIsoDate(document?.createdAt),
      modifiedTime: safeForumIsoDate(document?.updatedAt),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function ForumHelpDetailRoute({ params }: PageProps) {
  const { slug } = await params;
  const document = process.env.NEXT_PUBLIC_CONVEX_URL
    ? await resolveForumHelpDocument(slug)
    : null;
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    if (document === null) {
      notFound();
    }
  }

  const title = document?.title ?? `Forum Help / ${humanizeSlug(slug)}`;
  const description = "A SYMBaiEX forum help or FAQ document.";
  const canonical = forumSiteUrl(`/help/${encodeURIComponent(slug)}`);

  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={[
          {
            "@type": "WebPage",
            name: title,
            description,
            url: canonical,
            ...(document
              ? {
                  datePublished: safeForumIsoDate(document.createdAt),
                  dateModified: safeForumIsoDate(document.updatedAt),
                }
              : {}),
          },
          breadcrumbStructuredData([
            { name: "Forum", url: forumSiteUrl("/") },
            { name: "Help / FAQ", url: forumSiteUrl("/help") },
            { name: title, url: canonical },
          ]),
        ]}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumHelpDetailPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        slug={slug}
      />
    </section>
  );
}

async function resolveForumHelpDocument(slug: string) {
  const convex = getServerConvexClient();
  if (!convex) {
    return undefined;
  }

  try {
    return await convex.query(convexRefs.forum.getHelpDocument, { slug });
  } catch {
    return undefined;
  }
}
