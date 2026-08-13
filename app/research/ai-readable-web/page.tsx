import { StructuredData } from "@/components/structured-data";
import { breadcrumbStructuredData } from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Making a Next.js and Convex site AI-readable",
  description:
    "An original SYMBaIEX implementation note on HTML, Markdown negotiation, crawler policy, structured data, IndexNow, and performance evidence.",
  alternates: { canonical: "/research/ai-readable-web" },
  openGraph: {
    type: "article",
    url: primarySiteUrl("/research/ai-readable-web"),
    title: "Making a Next.js and Convex site AI-readable",
    description:
      "An original SYMBaIEX implementation note on HTML, Markdown, structured data, and indexed freshness.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX research note: making a site AI-readable.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Making a Next.js and Convex site AI-readable",
    description:
      "Implementation notes on one truthful content graph for HTML, Markdown, sitemaps, feeds, and AI-discovery signals.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SYMBaIEX research note: making a site AI-readable.",
      },
    ],
  },
};

const canonical = primarySiteUrl("/research/ai-readable-web");

export default function AiReadableWebResearchPage() {
  return (
    <article className="page-frame page-frame-spacious">
      <StructuredData
        data={[
          {
            "@type": "Article",
            "@id": `${canonical}#article`,
            headline: "Making a Next.js and Convex site AI-readable",
            description: metadata.description,
            url: canonical,
            datePublished: "2026-08-13",
            dateModified: "2026-08-13",
            author: { "@id": `${primarySiteUrl("/")}#person` },
            publisher: { "@id": `${primarySiteUrl("/")}#organization` },
            isPartOf: { "@id": `${primarySiteUrl("/")}#website` },
            articleSection: "AI-readable web engineering",
          },
          breadcrumbStructuredData([
            { name: "Home", url: primarySiteUrl("/") },
            { name: "Research", url: primarySiteUrl("/research") },
            {
              name: "AI-readable web architecture",
              url: canonical,
            },
          ]),
        ]}
      />
      <div className="page-content-readable">
        <p className="page-kicker">
          Original implementation note · 13 Aug 2026
        </p>
        <h1 className="page-title mt-3">
          Making a Next.js + Convex site AI-readable
        </h1>
        <p className="page-lede mt-5">
          The reliable way to make a site discoverable to people, search
          engines, and user-directed agents is to publish one truthful content
          graph in several useful representations—not to build a second, hidden
          website for bots.
        </p>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">The implementation stack</h2>
          <div className="overflow-x-auto border border-row-border">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="border-b border-row-border bg-muted/20 font-mono text-[11px] uppercase">
                <tr>
                  <th className="px-3 py-2">Layer</th>
                  <th className="px-3 py-2">What it solves</th>
                  <th className="px-3 py-2">SYMBaiEX implementation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-row-border">
                <ResearchRow
                  layer="HTML"
                  solves="Human-readable authority"
                  implementation="Canonical pages remain the primary representation."
                />
                <ResearchRow
                  layer="Markdown"
                  solves="Low-friction retrieval"
                  implementation="Accept: text/markdown and .md aliases expose public pages only."
                />
                <ResearchRow
                  layer="llms.txt"
                  solves="Curated discovery"
                  implementation="A bounded map links canonical pages, feeds, policy, and the public forum."
                />
                <ResearchRow
                  layer="Robots + sitemap"
                  solves="Crawl boundaries"
                  implementation="Search, training, and private-account policies are separated."
                />
                <ResearchRow
                  layer="Feeds + IndexNow"
                  solves="Freshness"
                  implementation="RSS and publish/update notifications shorten discovery loops."
                />
                <ResearchRow
                  layer="JSON-LD"
                  solves="Entity meaning"
                  implementation="Stable people, articles, profiles, collections, and forum relationships."
                />
                <ResearchRow
                  layer="Logs"
                  solves="Operational truth"
                  implementation="Safe host/path/representation/UA dimensions reveal real crawler behavior."
                />
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">What the benchmark changed</h2>
          <p>
            A production Lighthouse network trace measured about 2,578 KiB on
            the home route before the performance pass. The largest request was
            a 2.05 MiB decorative sprite sheet. Responsive hero derivatives,
            removal of global idle prefetching, and a deferred decorative sprite
            reduced the same route to about 489 KiB in a later run. Lab scores
            still vary with cache state and browser scheduling, so the durable
            acceptance signal is the payload and LCP trend—not a single perfect
            score.
          </p>
          <p>
            The practical rule is simple: every above-the-fold request must earn
            its place. Decorative animation is loaded after the first paint;
            below-the-fold editorial media is not preloaded; and the hero uses
            responsive derivatives with an explicit high fetch priority.
          </p>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Authority rules</h2>
          <ul className="list-disc space-y-3 pl-6 leading-7">
            <li>Answer first, then show method, caveats, date, and sources.</li>
            <li>
              Make structured data agree with visible text; never invent FAQ,
              ratings, authors, or citations.
            </li>
            <li>
              Keep AI-search visibility separate from training permission and
              private-account access.
            </li>
            <li>
              Use stable canonical URLs and disclose AI authorship where it
              matters.
            </li>
          </ul>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-xl font-semibold">Primary references</h2>
          <ul className="list-disc space-y-3 pl-6 leading-7">
            <li>
              <Source href="https://developers.google.com/search/docs/appearance/ai-features">
                Google Search: AI features and your website
              </Source>{" "}
              — foundational SEO and visible-content guidance still applies.
            </li>
            <li>
              <Source href="https://developers.google.com/search/docs/fundamentals/ai-optimization-guide">
                Google Search: optimizing for generative AI features
              </Source>{" "}
              — warns against treating markup as a substitute for useful,
              original content.
            </li>
            <li>
              <Source href="https://developers.google.com/search/docs/appearance/structured-data/sd-policies">
                Google structured-data policies
              </Source>{" "}
              — markup must represent visible, truthful page content.
            </li>
            <li>
              <Source href="https://www.indexnow.org/documentation">
                IndexNow documentation
              </Source>{" "}
              — bounded URL notifications improve freshness, but acceptance is
              not an indexing guarantee.
            </li>
            <li>
              <Source href="https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview">
                Bing AI Performance preview
              </Source>{" "}
              — citation visibility is an operational metric to monitor, not a
              promise to manufacture.
            </li>
          </ul>
        </section>
      </div>
    </article>
  );
}

function ResearchRow({
  layer,
  solves,
  implementation,
}: {
  layer: string;
  solves: string;
  implementation: string;
}) {
  return (
    <tr>
      <th className="px-3 py-3 font-semibold">{layer}</th>
      <td className="px-3 py-3">{solves}</td>
      <td className="px-3 py-3 text-muted-foreground">{implementation}</td>
    </tr>
  );
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="underline" href={href} rel="noopener noreferrer">
      {children}
    </a>
  );
}
