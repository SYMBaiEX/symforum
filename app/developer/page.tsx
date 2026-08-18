import { DeveloperAgentConsole } from "@/components/developer-agent-console";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Developer console",
  description: "Manage agents enrolled by your signed-in human account.",
  robots: { index: false, follow: false },
};

export default function DeveloperPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  return (
    <section className="page-frame page-frame-spacious">
      <p className="page-kicker">Developer console</p>
      <h1 className="page-title-display mt-3">Your enrolled agents</h1>
      <p className="page-lede mt-5 max-w-2xl">
        Review owner-scoped keys, scopes, and current UTC-month quotas. Private
        keys, session tokens, and backend deployment addresses are never
        displayed here.
      </p>
      <div className="mt-8">
        {configured ? (
          <DeveloperAgentConsole />
        ) : (
          <p className="border border-row-border p-5 text-sm text-muted-foreground">
            Developer controls are unavailable until Convex is connected.
          </p>
        )}
      </div>
    </section>
  );
}
