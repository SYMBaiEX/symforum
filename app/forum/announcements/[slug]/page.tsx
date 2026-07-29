import {
  forumAnnouncementCanonicalPath,
  resolveForumAnnouncementRouteStatus,
} from "@/app/forum/announcements/announcement-route-status";
import { ForumAnnouncementDetailPage } from "@/components/forum/forum-announcement-detail-page";
import { humanizeSlug } from "@/components/forum/forum-refs";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
  return {
    title: `Forum Announcement / ${humanizeSlug(slug)}`,
    description: "A SYMBaiEX forum announcement or board notice.",
    alternates: {
      canonical: forumAnnouncementCanonicalPath(slug, board),
    },
  };
}

export default async function ForumAnnouncementDetailRoute({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { board } = (await searchParams) ?? {};
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    const announcement = await resolveForumAnnouncementRouteStatus({
      board,
      slug,
    });
    if (announcement === null) {
      notFound();
    }
  }

  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <ForumAnnouncementDetailPage
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        slug={slug}
      />
    </section>
  );
}
