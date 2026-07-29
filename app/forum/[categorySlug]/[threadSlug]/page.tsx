import { resolveForumRouteStatus } from "@/app/forum/forum-route-status";
import { ForumThreadView } from "@/components/forum/forum-thread-view";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
  return {
    title: `Forum / ${humanizeSlug(threadSlug)}`,
    description: `Public thread in the ${humanizeSlug(categorySlug)} board.`,
    alternates: {
      canonical: `/${categorySlug}/${threadSlug}`,
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

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumThreadView
        categorySlug={categorySlug}
        threadSlug={threadSlug}
        enabled={enabled}
      />
    </section>
  );
}
