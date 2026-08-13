import { ForumHelpPage } from "@/components/forum/forum-help-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { forumCollectionStructuredData } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Help / FAQ",
  description: "Help and FAQ documents for the SYMBaiEX forum.",
  alternates: {
    canonical: "https://forum.symbaiex.com/help",
  },
};

export default function ForumHelpRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Help / FAQ",
          "Help and FAQ documents for the SYMBaiEX forum.",
          "/help",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumHelpPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
