import { forumSiteUrl, PRIMARY_SITE_URL } from "@/lib/site-urls";

export const SITE_NAME = "Austin Hamilton (SYMBiEX)";
export const AUTHOR_NAME = "Austin Hamilton";
export const AUTHOR_URL = `${PRIMARY_SITE_URL}/about`;

export const SITE_SAME_AS = [
  "https://github.com/SYMBaiEX",
  "https://www.linkedin.com/in/austinhamiltonal",
  "https://twitter.com/symbiex",
];

const SEO_TITLE_LIMIT = 60;

export const HOME_FAQS = [
  {
    question: "What is SYMBaiEX?",
    answer:
      "SYMBaiEX is Austin Hamilton's public engineering and research publication. It combines essays, source-linked news, open-source project notes, a public forum, and machine-readable evidence services.",
  },
  {
    question: "Can an AI agent read or use SYMBaiEX?",
    answer:
      "Yes. Public pages have Markdown representations, feeds, structured data, and discovery catalogs. Owner-directed agents can also enroll an Ed25519 public key for scoped REST or MCP access without sharing a private key.",
  },
  {
    question: "Does SYMBaiEX accept payments for agent access?",
    answer:
      "No. Public discovery and normal forum browsing are free, authenticated evidence access is in a quota-limited free beta, and no premium payment rail is active or advertised.",
  },
] as const;

/**
 * Keep document titles within the common search-result display budget while
 * retaining the route's brand context. The full title remains available in
 * visible headings and structured data; this is only for the HTML title tag.
 */
export function compactSeoTitle(value: string, brand: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const suffix = ` | ${brand}`;
  const titleBudget = SEO_TITLE_LIMIT - suffix.length;

  if (normalized.length <= titleBudget) {
    return `${normalized}${suffix}`;
  }

  const truncated = normalized
    .slice(0, Math.max(1, titleBudget - 1))
    .replace(/\s+\S*$/, "")
    .trim();
  return `${truncated || normalized.slice(0, titleBudget - 1).trim()}…${suffix}`;
}

export function siteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": `${AUTHOR_URL}#austin-hamilton`,
        name: AUTHOR_NAME,
        url: AUTHOR_URL,
        jobTitle: "Software engineer and AI systems researcher",
        description:
          "Self-taught software engineer, researcher, open-source contributor, and founder of SYMBaiEX.",
        homeLocation: {
          "@type": "Place",
          name: "Birmingham, Alabama",
        },
        sameAs: SITE_SAME_AS,
      },
      {
        "@type": "Organization",
        "@id": `${PRIMARY_SITE_URL}#organization`,
        name: "SYMBaiEX",
        url: PRIMARY_SITE_URL,
        founder: { "@id": `${AUTHOR_URL}#austin-hamilton` },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "general inquiries",
          email: "austin@symbaiex.com",
          url: `${PRIMARY_SITE_URL}/contact`,
          availableLanguage: "English",
        },
        address: {
          "@type": "PostalAddress",
          addressLocality: "Birmingham",
          addressRegion: "AL",
          addressCountry: "US",
        },
        sameAs: SITE_SAME_AS,
      },
      {
        "@type": "WebSite",
        "@id": `${PRIMARY_SITE_URL}#website`,
        name: SITE_NAME,
        url: PRIMARY_SITE_URL,
        publisher: { "@id": `${PRIMARY_SITE_URL}#organization` },
        inLanguage: "en-US",
      },
      {
        "@type": "WebPage",
        "@id": `${PRIMARY_SITE_URL}#homepage`,
        name: SITE_NAME,
        url: PRIMARY_SITE_URL,
        description:
          "Austin Hamilton's public engineering, AI-systems, open-source, and source-grounded research publication.",
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: [".agent-ready-summary", ".agent-ready-usage"],
        },
        isPartOf: { "@id": `${PRIMARY_SITE_URL}#website` },
      },
      {
        "@type": "Service",
        "@id": `${PRIMARY_SITE_URL}#agent-evidence-service`,
        name: "SYMBaiEX public evidence service",
        serviceType: "Source-linked public research and evidence API",
        description:
          "Versioned REST and MCP access to current public evidence, citations, claim verification, research jobs, exports, and signed events.",
        provider: { "@id": `${PRIMARY_SITE_URL}#organization` },
        areaServed: "Worldwide",
        url: `${PRIMARY_SITE_URL}/developers`,
        termsOfService: `${PRIMARY_SITE_URL}/terms`,
      },
      {
        "@type": "DataCatalog",
        "@id": `${PRIMARY_SITE_URL}/research#catalog`,
        name: "SYMBaiEX research and evidence catalog",
        description:
          "Public source-grounded research notes, evidence records, citations, and revision history.",
        url: `${PRIMARY_SITE_URL}/research`,
        publisher: { "@id": `${PRIMARY_SITE_URL}#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${PRIMARY_SITE_URL}#faq`,
        url: PRIMARY_SITE_URL,
        mainEntity: HOME_FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

export function breadcrumbStructuredData(
  items: Array<{ name: string; url: string }>,
) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function forumCollectionStructuredData(
  name: string,
  description: string,
  path: string,
) {
  const url = forumSiteUrl(path);
  return [
    {
      "@type": "CollectionPage",
      "@id": `${url}#collection`,
      name,
      description,
      url,
      isPartOf: { "@id": `${PRIMARY_SITE_URL}#website` },
    },
    breadcrumbStructuredData([
      { name: "Home", url: PRIMARY_SITE_URL },
      { name, url },
    ]),
  ];
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
