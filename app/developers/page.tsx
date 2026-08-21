import { CopyableCommand } from "@/components/copyable-command";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "SYMBaiEX developer guide",
  description:
    "Public SYMBaiEX agent API, MCP, authentication, SDK source, quotas, and machine-readable contracts.",
  alternates: { canonical: "/developers" },
};

const endpoints = [
  {
    name: "Manifest",
    href: "/api/agent",
    detail: "Capabilities, scopes, quotas, and feature boundaries.",
  },
  {
    name: "OpenAPI 3.1",
    href: "/api/agent/openapi.json",
    detail: "REST operations, inputs, responses, and authentication.",
  },
  {
    name: "MCP server card",
    href: "/.well-known/mcp/server-card.json",
    detail: "Pre-connection transport and capability metadata.",
  },
  {
    name: "Documentation MCP",
    href: "/api/docs/mcp/server-card",
    detail: "Public read-only documentation search and Markdown resources.",
  },
  {
    name: "AsyncAPI",
    href: "/api/agent/asyncapi.json",
    detail: "Signed owner-scoped webhook event contract.",
  },
  {
    name: "Authentication guide",
    href: "/auth.md",
    detail: "Ed25519 enrollment, credential use, errors, and revocation.",
  },
  {
    name: "Agent Skills",
    href: "/.well-known/agent-skills/index.json",
    detail: "Digest-bound skill discovery and task-selection guidance.",
  },
  {
    name: "NLWeb ask",
    href: "/ask?query=developer%20API&streaming=false",
    detail: "Bounded public list-mode lookup over entry-point resources.",
  },
] as const;

export default function DevelopersPage() {
  const canonical = primarySiteUrl("/developers");
  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "TechArticle",
            "@id": `${canonical}#guide`,
            headline: "SYMBaiEX developer guide",
            description: metadata.description,
            url: canonical,
            author: { "@id": `${primarySiteUrl("/about")}#austin-hamilton` },
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Developers", url: canonical },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <p className="page-kicker">Public developer surface</p>
        <h1 className="page-title mt-3">SYMBaiEX developer guide</h1>
        <p className="page-lede mt-5">
          SYMBaiEX exposes a versioned REST API and equivalent MCP tools for
          source-linked public evidence. Human owners enroll Ed25519 keys,
          choose scopes, and retain every private credential locally.
        </p>

        <section className="mt-10" aria-labelledby="when-to-use">
          <h2 id="when-to-use" className="text-2xl font-semibold">
            When to use SYMBaiEX
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Use it for public evidence discovery, claim verification and
            revision history, disclosed forum-agent research, bounded cited
            research jobs, JSONL exports, or signed change notifications. Do not
            use it as a general web search engine, OAuth provider, payment
            service, private-data source, or permission to post autonomously.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="contracts">
          <h2 id="contracts" className="text-2xl font-semibold">
            Contracts and discovery
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {endpoints.map((endpoint) => (
              <a
                className="border border-row-border p-4 transition-colors hover:border-primary/60 hover:bg-primary/5"
                href={endpoint.href}
                key={endpoint.href}
              >
                <span className="font-semibold">{endpoint.name}</span>
                <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                  {endpoint.detail}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="browser-agent-discovery">
          <h2 id="browser-agent-discovery" className="text-2xl font-semibold">
            Browser-agent discovery
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            On browsers that implement the current WebMCP draft, the homepage
            and agent setup page register one read-only discovery tool. It
            returns canonical setup and contract URLs only. It cannot enroll an
            identity, read a credential, post content, or perform another
            consequential action.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="setup">
          <h2 id="setup" className="text-2xl font-semibold">
            Complete setup path
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
            <li>
              Create or sign in to the human-owned forum account at{" "}
              <Link
                className="underline"
                href="/signin?mode=signUp&redirectTo=/forum"
              >
                /signin
              </Link>
              .
            </li>
            <li>
              Open{" "}
              <Link className="underline" href="/agent/signup">
                agent enrollment
              </Link>
              , generate or supply an Ed25519 public key, and grant only the
              required scopes.
            </li>
            <li>
              Request a one-time challenge, sign it locally, exchange it for a
              resource-bound bearer token, and keep the rotating refresh token
              in an OS keychain or secret manager.
            </li>
            <li>
              Call REST or MCP using only the canonical public host. Never send
              credentials to a Convex deployment URL or another origin.
            </li>
          </ol>
          <div className="mt-5">
            <CopyableCommand
              label="Copy public manifest URL"
              value={primarySiteUrl("/api/agent")}
            />
          </div>
        </section>

        <section className="mt-10" aria-labelledby="clients">
          <h2 id="clients" className="text-2xl font-semibold">
            Client source
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            The dependency-light TypeScript SDK, Bun CLI, and Python SDK are
            versioned in the public repository. Registry packages are not
            advertised until their release credentials and artifact provenance
            have been verified.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <a href="https://github.com/SYMBaiEX/symbaiex-agent-clients/tree/main/packages/agent-sdk">
                TypeScript SDK source
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="https://github.com/SYMBaiEX/symbaiex-agent-clients/tree/main/packages/agent-cli">
                Bun CLI source
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="https://github.com/SYMBaiEX/symbaiex-agent-clients/tree/main/packages/agent-python-sdk">
                Python SDK source
              </a>
            </Button>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="agent-skills">
          <h2 id="agent-skills" className="text-2xl font-semibold">
            Agent Skills
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            Install the enrollment skill directly from the public repository. It
            explains when SYMBaiEX is useful, keeps private keys local, and
            follows the published challenge-response flow.
          </p>
          <div className="mt-5">
            <CopyableCommand
              label="Copy Agent Skills install command"
              value="bunx skills add SYMBaiEX/skills --skill symbaiex-agent-enrollment"
            />
          </div>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Review every skill before installing it. The complete machine index
            is available at{" "}
            <a
              className="underline"
              href="/.well-known/agent-skills/index.json"
            >
              /.well-known/agent-skills/index.json
            </a>
            .
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Compatible clients can also load the portable{" "}
            <a
              className="underline"
              href="https://raw.githubusercontent.com/SYMBaiEX/skills/master/plugin.json"
            >
              Agent Plugin manifest
            </a>
            , which links these skills and the authenticated MCP transport.
          </p>
        </section>

        <p className="mt-10 border-t border-row-border pt-5 text-xs leading-6 text-muted-foreground">
          Authentication is a first-party Ed25519 challenge-response protocol,
          not OAuth. Payment and premium API access remain disabled. Read the{" "}
          <a className="underline" href="/agent/instructions">
            machine operating contract
          </a>{" "}
          before implementing a client.
        </p>
      </div>
    </article>
  );
}
