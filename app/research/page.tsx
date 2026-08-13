import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research hub",
  description:
    "Curated research topic hubs for SYMBaIEX with practical guidance, implementation notes, and source-backed references.",
  alternates: { canonical: "/research" },
  openGraph: {
    type: "website",
    url: primarySiteUrl("/research"),
    title: "Research hubs",
    description:
      "Curated topic hubs for SYMBiEX implementation notes and discoverability paths.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX research map and source-backed methodology notes.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMBaIEX research hubs",
    description:
      "A compact map to source-backed notes, implementation papers, and policy surfaces.",
    images: ["/opengraph-image"],
  },
};

const canonical = primarySiteUrl("/research");
const hubs = [
  {
    name: "AI-readable web architecture",
    path: "/research/ai-readable-web",
    summary:
      "How SYMBaIEX publishes one truthful content graph across HTML, Markdown, sitemap, and feeds.",
  },
];

export default function ResearchHubPage() {
  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "CollectionPage",
            "@id": `${canonical}#collection`,
            name: "SYMBaIEX research hub",
            description: metadata.description,
            url: canonical,
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
            hasPart: hubs.map((hub) => ({
              "@type": "WebPage",
              "@id": `${primarySiteUrl(hub.path)}#webpage`,
              name: hub.name,
              url: primarySiteUrl(hub.path),
            })),
            dateModified: "2026-08-13",
          },
          {
            "@type": "ItemList",
            "@id": `${canonical}#hubs`,
            name: "SYMBaIEX research topics",
            itemListElement: hubs.map((hub, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: hub.name,
              url: primarySiteUrl(hub.path),
            })),
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Research", url: canonical },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <p className="page-kicker">Research discovery</p>
        <h1 className="page-title mt-3">Research hubs</h1>
        <p className="page-lede mt-5">
          Use this compact hub first: choose a topic, then read the linked
          implementation note. Content is evidence-first and keeps visible text,
          metadata, and machine-readable sources aligned.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">What you can discover here</h2>
          <p>
            Start with the fastest path: the answer page then the source pages.
            Each hub links to one canonical HTML article and includes
            Markdown-accessible copies through the site’s negotiation layer.
          </p>
          <ol className="list-decimal space-y-4 pl-6">
            {hubs.map((hub) => (
              <li key={hub.path}>
                <a className="underline" href={hub.path}>
                  {hub.name}
                </a>
                <p className="text-sm text-muted-foreground">{hub.summary}</p>
                <p className="text-sm text-muted-foreground">
                  Canonical page: <code>{primarySiteUrl(hub.path)}</code>
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">
            How SYMBiEX keeps this discoverable
          </h2>
          <p>
            A research hub entry is published as HTML with matching JSON-LD and
            mirrored in machine-readable surfaces.
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <a className="underline" href="/sitemap.xml">
                Sitemap
              </a>{" "}
              includes canonical public routes for discovery.
            </li>
            <li>
              <a className="underline" href="/llms.txt">
                llms.txt
              </a>{" "}
              provides a bounded map to public pages and operating contracts.
            </li>
            <li>
              <a className="underline" href="/llms-full.txt">
                llms-full.txt
              </a>{" "}
              includes high-value Markdown snapshots for indexing pipelines.
            </li>
            <li>
              <a className="underline" href="/ai-policy">
                AI access policy
              </a>{" "}
              states crawler, search, and training boundaries.
            </li>
          </ul>
        </section>
      </div>
    </article>
  );
}
