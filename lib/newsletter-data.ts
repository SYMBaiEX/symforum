import {
  convexRefs,
  type PublicNewsletterIssueRecord,
} from "@/lib/convex-refs";
import { readThroughServerCache } from "@/lib/server-cache";
import { getServerConvexClient } from "@/lib/server-convex";
import { cache } from "react";

const NEWSLETTER_ARCHIVE_TTL_MS = 60 * 1000;

export const getPublicNewsletterIssues = cache(
  async function getPublicNewsletterIssues(
    limit = 24,
  ): Promise<PublicNewsletterIssueRecord[]> {
    const convex = getServerConvexClient();
    if (convex === null) {
      return [];
    }
    return await readThroughServerCache(
      `newsletter:archive:${limit}`,
      NEWSLETTER_ARCHIVE_TTL_MS,
      async () => {
        try {
          return await convex.query(convexRefs.newsletter.listPublicIssues, {
            limit,
          });
        } catch (error) {
          console.warn("Unable to load newsletter archive", error);
          return [];
        }
      },
    );
  },
);

export const getPublicNewsletterIssue = cache(
  async function getPublicNewsletterIssue(
    slug: string,
  ): Promise<PublicNewsletterIssueRecord | null> {
    const convex = getServerConvexClient();
    if (convex === null) {
      return null;
    }
    return await readThroughServerCache(
      `newsletter:issue:${slug}`,
      NEWSLETTER_ARCHIVE_TTL_MS,
      async () => {
        try {
          return await convex.query(
            convexRefs.newsletter.readPublicIssueBySlug,
            { slug },
          );
        } catch (error) {
          console.warn("Unable to load newsletter issue", error);
          return null;
        }
      },
    );
  },
);
