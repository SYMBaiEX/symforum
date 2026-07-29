import { ForumHelpDetailPage } from "@/components/forum/forum-help-detail-page";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { convexRefs } from "@/lib/convex-refs";
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
  return {
    title: `Forum Help / ${humanizeSlug(slug)}`,
    description: "A SYMBaiEX forum help or FAQ document.",
    alternates: {
      canonical: `https://forum.symbaiex.com/help/${encodeURIComponent(slug)}`,
    },
  };
}

export default async function ForumHelpDetailRoute({ params }: PageProps) {
  const { slug } = await params;
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    const document = await resolveForumHelpDocument(slug);
    if (document === null) {
      notFound();
    }
  }

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-3" />
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
