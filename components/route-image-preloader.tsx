import { isForumHostname } from "@/components/forum/forum-host-url";

/**
 * Kept as a small routing helper for callers/tests. Route warming itself is
 * intentionally not mounted globally: Next links already prefetch on demand,
 * and eager idle work competes with the first meaningful paint.
 */
export function shouldPrefetchPrimaryRoutes(hostname: string) {
  return !isForumHostname(hostname);
}
