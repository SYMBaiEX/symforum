import { convexRefs } from "@/lib/convex-refs";
import { fetchHnStory, type HnStory } from "@/lib/hn";
import { ConvexHttpClient } from "convex/browser";
import { cache } from "react";

export const getIndexedStory = cache(async function getIndexedStory(
  hnItemId: number,
): Promise<HnStory | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const story = await client.query(convexRefs.news.getStory, { hnItemId });
      if (story) {
        return story;
      }
    } catch {
      // Fall back to the public HN item API so article routes still resolve.
    }
  }
  return await fetchHnStory(hnItemId);
});

export function stripHnHtml(text: string | undefined) {
  const stripped = (text ?? "")
    .replace(/<p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .trim();

  return decodeHtmlEntities(stripped);
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replace(
      /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
      (entity, code: string) => {
        const lowerCode = code.toLowerCase();
        if (lowerCode.startsWith("#x")) {
          const numeric = Number.parseInt(lowerCode.slice(2), 16);
          return Number.isFinite(numeric)
            ? String.fromCodePoint(numeric)
            : entity;
        }
        if (lowerCode.startsWith("#")) {
          const numeric = Number.parseInt(lowerCode.slice(1), 10);
          return Number.isFinite(numeric)
            ? String.fromCodePoint(numeric)
            : entity;
        }

        return namedEntities[lowerCode] ?? entity;
      },
    );
  }

  return decoded;
}
