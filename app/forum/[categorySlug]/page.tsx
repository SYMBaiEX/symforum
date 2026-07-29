import { resolveForumRouteStatus } from "@/app/forum/forum-route-status";
import { ForumThreadList } from "@/components/forum/forum-thread-list";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
  return {
    title: `Forum / ${humanizeSlug(categorySlug)}`,
    description: `Public thread list for the ${humanizeSlug(categorySlug)} board.`,
    alternates: {
      canonical: `/${categorySlug}`,
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

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumThreadList categorySlug={categorySlug} enabled={enabled} />
    </section>
  );
}
