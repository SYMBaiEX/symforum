export type RssItem = {
  title: string;
  url: string;
  description?: string;
  publishedAt?: string | number | Date;
};

export function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '\"':
        return "&quot;";
      default:
        return character;
    }
  });
}

export function renderRssFeed({
  title,
  url,
  description,
  items,
}: {
  title: string;
  url: string;
  description: string;
  items: RssItem[];
}) {
  const itemXml = items
    .map((item) => {
      const publishedAt = item.publishedAt
        ? new Date(item.publishedAt)
        : undefined;
      const dateXml = publishedAt && !Number.isNaN(publishedAt.valueOf())
        ? `<pubDate>${publishedAt.toUTCString()}</pubDate>`
        : "";
      const descriptionXml = item.description
        ? `<description>${escapeXml(item.description)}</description>`
        : "";
      const safeUrl = escapeXml(item.url);
      return [
        "<item>",
        `<title>${escapeXml(item.title)}</title>`,
        `<link>${safeUrl}</link>`,
        `<guid isPermaLink=\"true\">${safeUrl}</guid>`,
        descriptionXml,
        dateXml,
        "</item>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${escapeXml(title)}</title>`,
    `<link>${escapeXml(url)}</link>`,
    `<description>${escapeXml(description)}</description>`,
    itemXml,
    "</channel>",
    "</rss>",
  ].join("");
}

export function rssHeaders() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    "Content-Type": "application/rss+xml; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}
