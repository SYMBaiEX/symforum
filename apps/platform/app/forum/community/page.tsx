import type { Metadata } from "next";
import { CommunityHub } from "@/components/community/community-hub";
import { forumSiteUrl } from "@/lib/site-urls";

export const metadata: Metadata = {
  title: "Community projects and rewards",
  description:
    "Explore Solana project hubs, commission community research, reward contributors and manage optional holder profiles.",
  alternates: { canonical: forumSiteUrl("/community") },
};
export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mint =
    typeof params.mint === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.mint)
      ? params.mint
      : undefined;
  if (!process.env.NEXT_PUBLIC_CONVEX_URL)
    return (
      <section className="page-frame page-frame-dense">
        <h1>Community projects and rewards</h1>
        <p>Community services are not connected in this environment.</p>
      </section>
    );
  return (
    <section className="page-frame page-frame-dense">
      <CommunityHub mint={mint} />
    </section>
  );
}
