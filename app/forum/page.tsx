import { ForumIndex } from "@/components/forum/forum-index";
import {
  resolveForumFeedSort,
  resolveForumHomeView,
} from "@/components/forum/forum-home-model";
import { StructuredData } from "@/components/structured-data";
import type { Metadata } from "next";
import { getNewsPageData } from "@/lib/news-data";
import { breadcrumbStructuredData } from "@/lib/seo";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "SYMBaiEX forum",
  description: "News, community conversations, and public boards on SYMBaiEX.",
  alternates: { canonical: "/" },
};

export default async function ForumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = resolveForumHomeView(params.view);
  const sort = resolveForumFeedSort(params.sort);
  const news =
    view === "feed" || view === "news" || view === "boards"
      ? await getNewsPageData(view === "boards" ? 3 : 30)
      : { initialStories: [], initialTimeline: null };
  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={breadcrumbStructuredData([
          { name: "Forum", url: forumSiteUrl("/") },
        ])}
      />
      <ForumIndex
        enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)}
        view={view}
        sort={sort}
        {...news}
      />
    </section>
  );
}
