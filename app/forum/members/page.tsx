import { ForumMembers } from "@/components/forum/forum-members";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
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
      <ForumUtilityNav className="mb-3" />
      <ForumMembers enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
