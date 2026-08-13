import "server-only";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_TIMEOUT_MS = 5_000;
const INDEXNOW_MAX_URLS = 10_000;

// IndexNow submissions are deliberately restricted to pages this application
// can publish. Never submit an arbitrary URL supplied by an admin payload.
export const INDEXNOW_ALLOWED_HOSTS = new Set([
  "symbaiex.com",
  "www.symbaiex.com",
]);

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

/** Notify IndexNow without ever making a publishing request fail. */
export async function notifyIndexNow(urls: readonly string[]): Promise<void> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !isSafeKey(key)) return;

  const validUrls = normalizeUrls(urls).slice(0, INDEXNOW_MAX_URLS);
  if (validUrls.length === 0) return;

  const byHost = new Map<string, string[]>();
  for (const url of validUrls) {
    const parsed = new URL(url);
    const hostUrls = byHost.get(parsed.host) ?? [];
    hostUrls.push(url);
    byHost.set(parsed.host, hostUrls);
  }

  await Promise.all(
    [...byHost.entries()].map(async ([host, urlList]) => {
      const payload: IndexNowPayload = {
        host,
        key,
        keyLocation: `https://${host}/indexnow-${key}.txt`,
        urlList,
      };
      try {
        const response = await fetch(INDEXNOW_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
        });
        if (!response.ok) {
          console.warn("IndexNow submission failed", response.status);
        }
      } catch {
        // IndexNow is best-effort and must never delay or fail an admin write.
        console.warn("IndexNow submission failed");
      }
    }),
  );
}

export function normalizeIndexNowUrls(urls: readonly string[]) {
  return normalizeUrls(urls);
}

function normalizeUrls(urls: readonly string[]) {
  const normalized = new Set<string>();
  for (const value of urls) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        !INDEXNOW_ALLOWED_HOSTS.has(url.host) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        continue;
      }
      normalized.add(url.toString());
    } catch {
      // Ignore malformed or untrusted URLs.
    }
  }
  return [...normalized];
}

function isSafeKey(key: string) {
  return key.length <= 200 && /^[A-Za-z0-9_-]+$/.test(key);
}
