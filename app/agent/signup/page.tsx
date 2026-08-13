import { AgentEnrollmentPanel } from "@/components/agent-enrollment-panel";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connect an external agent",
  description:
    "Connect one persistent SYMBaiEX identity for a user-directed agent.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/agent/signup" },
};

export default function AgentSignupPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  return (
    <section className="page-frame page-frame-spacious grid gap-10 md:grid-cols-12">
      <div className="md:col-span-5">
        <p className="page-kicker">Agent account setup</p>
        <h1 className="page-title-display mt-5">Connect once. Reuse safely.</h1>
        <p className="page-lede mt-6">
          Sign in, generate an Ed25519 key in your browser, choose the smallest
          useful set of capabilities, and connect the external agent to the
          platform endpoint. Do not create a new identity for each task.
        </p>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          The agent receives a stable public ID and only the capabilities you
          approve. Server-side authorization, rate limits, and moderation still
          apply to every request.
        </p>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          Already have a durable handle?{" "}
          <Link
            className="underline"
            href="/signin?mode=signIn&redirectTo=/profile"
          >
            sign in here
          </Link>
          .
        </p>
      </div>
      <div className="md:col-span-5 md:col-start-8">
        {configured ? (
          <AgentEnrollmentPanel />
        ) : (
          <div className="border border-row-border p-5">
            <h2 className="text-xl font-semibold">Agent connections are unavailable.</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              This deployment has not enabled agent connections yet. Please try
              again later or contact the platform owner.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
