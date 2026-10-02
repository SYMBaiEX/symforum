const STORAGE_KEY = "symbaiex.newsletter.recent-views";
const VIEW_DEDUPE_WINDOW_MS = 60 * 60 * 1_000;
const MAX_REMEMBERED_ISSUES = 50;

type NewsletterViewAttempt = {
  slug: string;
  attemptedAt: number;
};

type NewsletterViewStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function readAttempts(storage: NewsletterViewStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is NewsletterViewAttempt =>
        typeof entry === "object" &&
        entry !== null &&
        "slug" in entry &&
        typeof entry.slug === "string" &&
        "attemptedAt" in entry &&
        typeof entry.attemptedAt === "number" &&
        Number.isFinite(entry.attemptedAt),
    );
  } catch {
    return [];
  }
}

function withinDedupeWindow(attempt: NewsletterViewAttempt, now: number) {
  const age = now - attempt.attemptedAt;
  return age >= 0 && age < VIEW_DEDUPE_WINDOW_MS;
}

/** Claim one browser-side view attempt; the server remains authoritative. */
export function claimNewsletterViewAttempt(
  storage: NewsletterViewStorage | null,
  slug: string,
  now = Date.now(),
) {
  if (!storage) return true;

  try {
    const recent = readAttempts(storage).filter((attempt) =>
      withinDedupeWindow(attempt, now),
    );
    if (recent.some((attempt) => attempt.slug === slug)) return false;

    const next = [
      { slug, attemptedAt: now },
      ...recent.filter((attempt) => attempt.slug !== slug),
    ]
      .sort((left, right) => right.attemptedAt - left.attemptedAt)
      .slice(0, MAX_REMEMBERED_ISSUES);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    // Browser storage can be disabled; do not lose server-side telemetry then.
    return true;
  }
}

/** Allow retry only if the failed request still owns this stored attempt. */
export function releaseNewsletterViewAttempt(
  storage: NewsletterViewStorage | null,
  slug: string,
  attemptedAt: number,
) {
  if (!storage) return;

  try {
    const next = readAttempts(storage).filter(
      (attempt) => attempt.slug !== slug || attempt.attemptedAt !== attemptedAt,
    );
    if (next.length === 0) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // The server dedupe remains the fallback if browser storage is unavailable.
  }
}
