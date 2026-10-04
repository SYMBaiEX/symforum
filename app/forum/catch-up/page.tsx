import { ForumCatchUp } from "@/components/forum/forum-catch-up";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Catch up • SYMBaiEX",
  robots: { index: false, follow: false },
};
export default function CatchUpPage() {
  return (
    <section className="page-frame page-frame-dense">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Your forum</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Catch up, choose your interests, and find your next conversation.
        </p>
      </header>
      {process.env.NEXT_PUBLIC_CONVEX_URL ? (
        <ForumCatchUp />
      ) : (
        <p>Connect the forum backend to catch up.</p>
      )}
    </section>
  );
}
