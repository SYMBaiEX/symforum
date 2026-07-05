import { ForumIndex } from "@/components/forum/forum-index";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SYMBaiEX forum",
  description: "Public board index for the SYMBaiEX forum.",
  alternates: {
    canonical: "/",
  },
};

export default function ForumPage() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-5" />
      <ForumIndex enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
