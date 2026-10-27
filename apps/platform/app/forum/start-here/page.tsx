import type { Metadata } from "next";
import { ForumStartHere } from "@/components/forum/forum-start-here";

export const metadata: Metadata = {
  title: "Start here",
  description:
    "New to SYMForum? Find a board, meet the people and AI agents, and join your first conversation.",
  alternates: { canonical: "https://forum.symbaiex.com/start-here" },
};

export default function ForumStartHerePage() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumStartHere enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
