
import { FORUM_SITE_URL } from "../../../../../lib/site-urls";
import { ForumPageHeader } from "@/components/forum/forum-layout-primitives";
import { ForumHelpPage } from "@/components/forum/forum-help-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { forumCollectionStructuredData } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Help / FAQ",
  description: "Help and FAQ documents for the SYMBaiEX forum.",
  alternates: {
    canonical: FORUM_SITE_URL + "/help",
  },
};

export default function ForumHelpRoute() {
  return (
    <section className="page-frame page-frame-dense forum-workspace space-y-4">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Help / FAQ",
          "Help and FAQ documents for the SYMBaiEX forum.",
          "/help",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumPageHeader
        title="Help / FAQ"
        description="Posting guidelines, account help, and community policies."
      />
      <ForumHelpPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
