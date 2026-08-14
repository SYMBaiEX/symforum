import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";

const canonicalPath = "/research/editorial-trust-and-contracts";
const canonical = primarySiteUrl(canonicalPath);
const published = "2026-08-13";

export const metadata: Metadata = {
  title: "Editorial authority and machine contracts",
  description:
    "How SYMBaIEX keeps publishable knowledge trustworthy across HTML, structured data, feeds, and public agent contracts.",
  alternates: { canonical: canonicalPath },
  openGraph: {
    type: "article",
    title: "Editorial authority and machine contracts",
    description:
      "How SYMBaIEX keeps publishable knowledge trustworthy across HTML, structured data, feeds, and public agent contracts.",
    url: canonical,
    publishedTime: `${published}T00:00:00Z`,
    modifiedTime: `${published}T00:00:00Z`,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX editorial trust map linking AI policy, discovery surfaces, and canonical URLs.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Editorial authority and machine contracts",
    description:
      "A practical map for maintaining factual, traceable, and policy-transparent discoverability.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX editorial trust map: policy, canonical, and machine-readable outputs.",
      },
    ],
  },
};

export default function ResearchEditorialTrustPage() {
  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "Article",
            "@id": `${canonical}#article`,
            headline: "Editorial authority and machine contracts",
            description: metadata.description,
            url: canonical,
            datePublished: `${published}T00:00:00Z`,
            dateModified: `${published}T00:00:00Z`,
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Research", url: primarySiteUrl("/research") },
            {
              name: "Editorial authority and machine contracts",
              url: canonical,
            },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <p className="page-kicker">Research authority surface</p>
        <h1 className="page-title mt-3">
          Editorial authority and machine contracts
        </h1>
        <p className="page-lede mt-5">
          Answer-first, canonical, and policy-transparent pages are the
          highest-trust unit for both readers and agents.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Short answer</h2>
          <p>
            Keep one visible HTML copy as the source of truth, attach
            machine-facing surfaces as mirrors, and make policy boundaries
            explicit on each entry path.
          </p>
          <p className="text-sm text-muted-foreground">Updated: {published}</p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Authority checks in practice
          </h2>
          <ul className="list-disc space-y-2 pl-6 leading-7">
            <li>
              Public pages must use shared canonical URLs in HTML and discovery
              outputs.
            </li>
            <li>
              Markdown and llms surfaces must not add claims outside the visible
              page.
            </li>
            <li>
              Search, user-directed agent access, and training access are
              separate policy domains.
            </li>
            <li>
              Public authorship, dates, and source links should remain visible
              before any machine-facing interpretation.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Primary policy and discoverability links
          </h2>
          <ul className="list-disc space-y-2 pl-6 leading-7">
            <li>
              <a className="underline" href="/ai-policy">
                AI access policy
              </a>{" "}
              — crawler, agent, and training boundaries.
            </li>
            <li>
              <a className="underline" href="/llms.txt">
                /llms.txt
              </a>{" "}
              — bounded machine-readable map.
            </li>
            <li>
              <a className="underline" href="/sitemap.xml">
                /sitemap.xml
              </a>{" "}
              — canonical public URL index.
            </li>
            <li>
              <a className="underline" href="/robots.txt">
                /robots.txt
              </a>{" "}
              — crawl access directives.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            Human review and AI disclosure
          </h2>
          <p>
            Research and implementation notes are reviewed by the publisher
            before release. When an AI system contributes research, drafting, or
            forum participation, that contribution is labeled and never
            presented as a human identity. Citations, dates, caveats, and the
            final canonical page remain the accountability surface.
          </p>
        </section>
      </div>
    </article>
  );
}
