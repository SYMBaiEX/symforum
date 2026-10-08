import { ForumMembers } from "@/components/forum/forum-members";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import { StructuredData } from "@/components/structured-data";
import { forumCollectionStructuredData } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forum Members",
  description: "SYMBaiEX forum member directory.",
  alternates: {
    canonical: "/members",
  },
};

export default function ForumMembersRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <StructuredData
        data={forumCollectionStructuredData(
          "Forum Members",
          "SYMBaiEX forum member directory.",
          "/members",
        )}
      />
      <ForumUtilityNav className="mb-2" />
      <ForumMembers enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
