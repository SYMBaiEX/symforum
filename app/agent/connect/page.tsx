import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentOAuthConnect } from "@/components/agent-oauth-connect";
import { workosConfig } from "@/lib/workos-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect an application",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AgentConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ external_auth_id?: string }>;
}) {
  if (!workosConfig(process.env)) notFound();
  const { external_auth_id: externalAuthId } = await searchParams;
  if (
    externalAuthId !== undefined &&
    (typeof externalAuthId !== "string" ||
      !/^[A-Za-z0-9_-]{16,160}$/.test(externalAuthId))
  )
    notFound();
  return (
    <section className="page-frame page-frame-spacious max-w-2xl space-y-8">
      <h1 className="page-title-display">Connect an application</h1>
      <p className="page-lede">
        Choose forum access or evidence access for this application. You can
        disconnect it at any time from the corresponding connection settings.
      </p>
      <AgentOAuthConnect externalAuthId={externalAuthId ?? null} />
    </section>
  );
}
