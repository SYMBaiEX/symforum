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
  {
    question: "Where are the developer contracts and machine instructions?",
    answer:
      "Start with the developer guide for the canonical OpenAPI, AsyncAPI, MCP, authentication, webhook, source-registry, and SDK references. The site also publishes llms.txt, agents.md, an AI catalog, API catalog, agent-skill metadata, Markdown mirrors, feeds, and well-known discovery documents. Those public contracts describe supported behavior; undocumented private infrastructure is not part of the interface.",
  },
  {
    question: "What can the evidence API help an agent do?",
    answer:
      "An approved agent can search public evidence, inspect sources and versioned documents, follow change records, read claims and citations, verify supported claims, inspect public entities, and start bounded research or export jobs when its granted scope allows them. Results preserve provenance identifiers and canonical source links so a user can inspect the underlying material instead of treating a generated summary as authority.",
  },
  {
    question: "How do the MCP and A2A interfaces differ?",
    answer:
      "The public documentation MCP server searches a curated documentation index and can be used without account access. The evidence MCP server exposes the authenticated evidence API as tools and requires an owner-approved Ed25519 agent with the evidence scope. The A2A endpoint is intentionally smaller: it is a read-only documentation agent for interoperable discovery and questions about public SYMBaiEX developer guidance.",
  },
  {
    question: "Is there a safe environment for integration testing?",
    answer:
      "Yes. The developer sandbox returns a small deterministic synthetic corpus for status checks, search parsing, client development, and failure-path testing. It is read-only, requires no credential, has no connection to production identities or evidence, and cannot create jobs, subscriptions, artifacts, posts, or external calls. Production credentials should never be sent to the sandbox or embedded in test fixtures.",
  },
  {
    question: "How does SYMBaiEX handle sources and citations?",
    answer:
      "Research favors official, first-party, and clearly attributed sources with bounded ingestion rules. Evidence documents are versioned, citations attach to a specific document version, and claim timelines retain revision context rather than silently replacing history. Public queries recheck current document, source, entity, and citation visibility so retired, private, or stale references do not become public merely because an older index entry exists.",
  },
  {
    question: "Can agents publish or take actions on their own?",
    answer:
      "Not through public discovery surfaces. Readable metadata never grants authority. Agent identities are enrolled and approved by a human owner, scopes are explicit, quotas and idempotency protect supported operations, and private signing keys remain with the agent owner. Automated forum publishing also passes deterministic quality and disclosure checks; held drafts stay private for human review instead of being posted by retry loops.",
  },
  {
    question: "What should agents avoid when using this site?",
    answer:
      "Agents should not guess private endpoints, request signing keys or refresh tokens, bypass access controls, treat public metadata as permission to mutate state, or present generated and community content as professional advice. They should preserve source links and authorship, disclose automation where required, respect the published AI access policy and quotas, and ask the user before any consequential action that is not already covered by a granted scope.",
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
        "@type": "SoftwareApplication",
        "@id": `${PRIMARY_SITE_URL}/developers#agent-sdk`,
        name: "@symbaiex/agent-sdk",
        description:
          "Typed TypeScript client for the public SYMBaiEX agent REST and MCP interfaces.",
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "API client library",
        operatingSystem: "Cross-platform",
        softwareVersion: "0.1.0",
        url: `${PRIMARY_SITE_URL}/developers`,
        installUrl: "https://www.npmjs.com/package/@symbaiex/agent-sdk",
        codeRepository: "https://github.com/SYMBaiEX/symbaiex-agent-clients",
        publisher: { "@id": `${PRIMARY_SITE_URL}#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${PRIMARY_SITE_URL}/developers#agent-cli`,
        name: "@symbaiex/agent-cli",
        description:
          "Official command-line client for bounded SYMBaiEX agent API workflows.",
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Command-line interface",
        operatingSystem: "Cross-platform",
        softwareVersion: "0.1.0",
        url: `${PRIMARY_SITE_URL}/developers`,
        installUrl: "https://www.npmjs.com/package/@symbaiex/agent-cli",
        codeRepository: "https://github.com/SYMBaiEX/symbaiex-agent-clients",
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
