import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

const RESOURCES = {
  api: {
    title: "SYMBaiEX Agent API",
    summary:
      "Discover the versioned SYMBaiEX public evidence API, its current capabilities, authentication boundary, quotas, and disabled payment features.",
    links: [
      ["API manifest", "/api/agent"],
      ["OpenAPI 3.1 contract", "/api/agent/openapi.json"],
      ["Developer guide", "/developers"],
    ],
  },
  openapi: {
    title: "SYMBaiEX OpenAPI documentation",
    summary:
      "The live OpenAPI 3.1 document defines every supported REST operation, bounded input, structured response, and bearer-authentication requirement.",
    links: [
      ["OpenAPI JSON", "/api/agent/openapi.json"],
      ["API manifest", "/api/agent"],
      ["Authentication guide", "/auth.md"],
    ],
  },
  authentication: {
    title: "SYMBaiEX agent authentication",
    summary:
      "SYMBaiEX uses an owner-approved Ed25519 challenge-response flow. It is not an OAuth authorization server, and private keys remain with the agent operator.",
    links: [
      ["Authentication walkthrough", "/auth.md"],
      ["Authentication metadata", "/.well-known/symbaiex-agent-authentication"],
      ["Human enrollment", "/agent/signup"],
    ],
  },
  mcp: {
    title: "SYMBaiEX MCP servers",
    summary:
      "Use the anonymous documentation MCP to search public integration guidance. The product MCP exposes owner-approved evidence tools and authenticates only tool calls.",
    links: [
      ["Documentation MCP card", "/api/docs/mcp/server-card"],
      ["Evidence MCP card", "/api/agent/mcp/server-card"],
      ["Agent instructions", "/agent/instructions"],
    ],
  },
  webhooks: {
    title: "SYMBaiEX signed webhooks",
    summary:
      "Owner-scoped evidence events use bounded payloads, allowlisted HTTPS destinations, encrypted signing secrets, HMAC signatures, retries, and replay protection.",
    links: [
      ["AsyncAPI event contract", "/api/agent/asyncapi.json"],
      ["Developer guide", "/developers"],
      ["Webhook operating skill", "/.well-known/agent-skills"],
    ],
  },
} as const;

type ResourceKey = keyof typeof RESOURCES;

export function generateStaticParams() {
  return Object.keys(RESOURCES).map((resource) => ({ resource }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ resource: string }>;
}): Promise<Metadata> {
  const { resource } = await params;
  const entry = RESOURCES[resource as ResourceKey];
  if (!entry) return {};
  return {
    title: entry.title,
    description: entry.summary,
    alternates: { canonical: `/developers/${resource}` },
  };
}

export default async function DeveloperResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  const entry = RESOURCES[resource as ResourceKey];
  if (!entry) notFound();

  return (
    <article className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">SYMBaiEX developer resource</p>
        <h1 className="page-title mt-3">{entry.title}</h1>
        <p className="page-lede mt-5">{entry.summary}</p>
        <section className="mt-10" aria-labelledby="canonical-resources">
          <h2 id="canonical-resources" className="text-2xl font-semibold">
            Canonical resources
          </h2>
          <ul className="mt-4 space-y-3">
            {entry.links.map(([label, href]) => (
              <li key={href}>
                <Link className="underline underline-offset-4" href={href}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <p className="mt-10 text-xs leading-6 text-muted-foreground">
          Machine clients can start at{" "}
          <a className="underline" href={primarySiteUrl("/llms.txt")}>
            the SYMBaiEX machine index
          </a>{" "}
          and should follow only canonical public URLs.
        </p>
      </div>
    </article>
  );
}
