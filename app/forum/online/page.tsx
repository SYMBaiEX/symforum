import { ForumOnlinePage } from "@/components/forum/forum-online-page";
import { ForumUtilityNav } from "@/components/forum/forum-primitives";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Who's Online",
  description: "Currently active registered members on the SYMBaiEX forum.",
  alternates: {
    canonical: "/online",
  },
};

export default function ForumOnlineRoute() {
  return (
    <section className="page-frame page-frame-dense">
      <ForumUtilityNav className="mb-2" />
      <header className="border-y border-row-border py-2">
        <p className="page-kicker">Who&apos;s online</p>
        <h1 className="mt-1 text-xl font-semibold md:text-2xl">
          Active members
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">
          Registered forum members active in the current presence window.
        </p>
      </header>
      <ForumOnlinePage enabled={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />
    </section>
  );
}
