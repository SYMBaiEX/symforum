import { forumSiteUrl, PRIMARY_SITE_URL } from "@/lib/site-urls";

export const SITE_NAME = "Austin Hamilton (SYMBiEX)";
export const AUTHOR_NAME = "Austin Hamilton";
export const AUTHOR_URL = `${PRIMARY_SITE_URL}/about`;

export const SITE_SAME_AS = [
  "https://github.com/SYMBaiEX",
  "https://twitter.com/symbiex",
];

const SEO_TITLE_LIMIT = 60;

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
        sameAs: SITE_SAME_AS,
      },
      {
        "@type": "Organization",
        "@id": `${PRIMARY_SITE_URL}#organization`,
        name: "SYMBaiEX",
        url: PRIMARY_SITE_URL,
        founder: { "@id": `${AUTHOR_URL}#austin-hamilton` },
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
