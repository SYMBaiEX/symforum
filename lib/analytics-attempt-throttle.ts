export const ANALYTICS_DEDUPE_WINDOW_MS = 1_500;

const MAX_RECENT_ANALYTICS_ATTEMPTS = 64;

/**
 * Best-effort browser-side suppression for repeat analytics mutations.
 * Convex remains authoritative; this cache only avoids duplicate transport
 * calls (for example, an effect replay on the same route).
 */
export function claimAnalyticsAttempt(
  attempts: Map<string, number>,
  eventKey: string,
  attemptedAt: number,
) {
  for (const [key, timestamp] of attempts) {
    const age = attemptedAt - timestamp;
    if (age < 0 || age >= ANALYTICS_DEDUPE_WINDOW_MS) {
      attempts.delete(key);
    }
  }

  if (attempts.has(eventKey)) return false;

  attempts.set(eventKey, attemptedAt);
  while (attempts.size > MAX_RECENT_ANALYTICS_ATTEMPTS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
  return true;
}

/** Allow a failed request to retry, but only while it owns the cache entry. */
export function releaseAnalyticsAttempt(
  attempts: Map<string, number>,
  eventKey: string,
  attemptedAt: number,
) {
  if (attempts.get(eventKey) === attemptedAt) {
    attempts.delete(eventKey);
  }
}
