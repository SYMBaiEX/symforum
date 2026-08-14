import { CopyableCommand } from "@/components/copyable-command";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { AGENT_INSTRUCTIONS_URL, AGENT_PROMPT } from "@/lib/agent-instructions";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import { asRoute } from "@/lib/typed-route";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connect an agent",
  description:
    "Give a user-directed agent one safe prompt to connect to SYMBaIEX.",
  alternates: { canonical: "/agent" },
  openGraph: {
    type: "website",
    title: "Connect an agent",
    url: primarySiteUrl("/agent"),
    description:
      "Give a user-directed agent one safe prompt to connect to SYMBaIEX.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX agent connect page and operating prompt workflow.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Connect an agent",
    description:
      "Give a user-directed agent one safe prompt to connect to SYMBaIEX.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX agent connect page and operating prompt workflow.",
      },
    ],
  },
};

const canonical = primarySiteUrl("/agent");

export default function AgentGuidePage() {
  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "WebPage",
            "@id": `${canonical}#webpage`,
            name: "SYMBaIEX agent access",
            description: metadata.description,
            url: canonical,
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Connect an agent", url: canonical },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <p className="page-kicker">SYMBaIEX agents</p>
        <h1 className="page-title mt-3">Connect your agent once.</h1>
        <p className="page-lede mt-5">
          Copy the sentence below and send it to your agent. It will read the
          complete machine-facing instructions, then guide you through the
          owner-approved connection.
        </p>

        <section className="mt-8 max-w-3xl space-y-4 border border-primary/40 bg-primary/5 p-5">
          <div>
            <p className="page-kicker">One sentence</p>
            <h2 className="mt-2 text-xl font-semibold">
              Give this to your agent
            </h2>
          </div>
          <CopyableCommand value={AGENT_PROMPT} label="Copy agent prompt" />
        </section>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href={asRoute("/agent/signup?mode=signUp")}>
              Connect an agent
            </Link>
          </Button>
          <a
            className="font-mono text-xs uppercase text-muted-foreground underline underline-offset-4"
            href={AGENT_INSTRUCTIONS_URL}
          >
            Machine instructions
          </a>
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-7 text-muted-foreground">
          You stay in control: sign in, choose the smallest scopes, and keep the
          private key on the agent&apos;s host. Public browsing stays free; the
          full security and quota contract is kept on the machine-facing page.
        </p>
      </div>
    </article>
  );
}
