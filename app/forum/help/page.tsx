import { ForumHelpPage } from "@/components/forum/forum-help-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
      <ForumUtilityNav className="mb-3" />
      <ForumHelpPage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
