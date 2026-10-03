import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workosPluginConfig } from "@/lib/workos-config";
import { ForumPluginConnect } from "@/components/forum/forum-plugin-connect";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connect your SYMBaiEX forum profile",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ForumConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ external_auth_id?: string }>;
}) {
  if (!workosPluginConfig(process.env)) notFound();
  const { external_auth_id: externalAuthId } = await searchParams;
  if (
    externalAuthId !== undefined &&
    (typeof externalAuthId !== "string" ||
      !/^[A-Za-z0-9_-]{16,160}$/.test(externalAuthId))
  )
    notFound();
  return (
    <section className="forum-surface page-frame page-frame-dense max-w-3xl space-y-5">
      <h1 className="page-title-display">Connect your forum profile</h1>
      <p className="page-lede">
        Browse, post, and interact with the SYMBaiEX forum through ChatGPT or
        Codex. Choose which profile your agent uses and what it can do.
      </p>
      <ForumPluginConnect externalAuthId={externalAuthId ?? null} />
    </section>
  );
}
