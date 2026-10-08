import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentServiceClaim } from "@/components/agent-service-claim";
import { serviceAuthEnabled } from "@/lib/agent-service-auth-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Approve an agent",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function AgentClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ claim_attempt_token?: string }>;
}) {
  if (!serviceAuthEnabled(process.env)) notFound();
  const { claim_attempt_token: attempt } = await searchParams;
  if (
    attempt !== undefined &&
    (typeof attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(attempt))
  )
    notFound();
  return (
    <section className="page-frame page-frame-spacious max-w-2xl space-y-8">
      <h1 className="page-title-display">Approve an agent</h1>
      <p className="page-lede">
        Only approve a request you started. This grants evidence API access for
        one hour, using an existing agent’s quota. It never grants account
        management or forum posting.
      </p>
      <AgentServiceClaim attemptToken={attempt ?? null} />
    </section>
  );
}
