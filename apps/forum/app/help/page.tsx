
import { FORUM_SITE_URL } from "../../../../lib/site-urls";
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
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Help / FAQ",
          "Help and FAQ documents for the SYMBaiEX forum.",
          "/help",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Forum helpdesk</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">Help / FAQ</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          Read posting guidelines, account information, and forum policies
          before opening a new thread.
        </p>
      </header>
      <ForumHelpPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
