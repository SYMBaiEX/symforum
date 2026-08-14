import "server-only";

import { getCache } from "@vercel/functions";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_TIMEOUT_MS = 5_000;
const INDEXNOW_MAX_URLS = 10_000;
const INDEXNOW_MAX_RETRY_ATTEMPTS = 3;
const INDEXNOW_RETRY_DELAY_MS = 250;
const INDEXNOW_IDEMPOTENCY_WINDOW_MS = 90_000;
const INDEXNOW_MAX_AUDIT_ENTRIES = 200;
const INDEXNOW_RUNTIME_CACHE_KEY = "indexnow-state-v1";
const INDEXNOW_RUNTIME_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

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

export type IndexNowEventSource = "post" | "newsletter_issue";
export type IndexNowEventAction = "create" | "update" | "delete" | "send";

export type IndexNowEventContext = {
  source: IndexNowEventSource;
  action: IndexNowEventAction;
  resourceId?: string;
};

export type IndexNowAuditRecord = {
  dedupeKey: string;
  host: string;
  status: "queued" | "skipped" | "succeeded" | "failed";
  source?: IndexNowEventSource;
  action?: IndexNowEventAction;
  resourceId?: string;
  urlCount: number;
  attempts: number;
  statusCode?: number;
  error?: string;
  createdAt: number;
};

type IndexNowOptions = {
  context?: IndexNowEventContext;
};

type IndexNowSubmissionState = {
  dedupeUntil: number;
};

type HostSubmissionResult = {
  succeeded: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
};

const indexNowDedup = new Map<string, IndexNowSubmissionState>();
const indexNowAudit: IndexNowAuditRecord[] = [];
const indexNowRuntimeCache = getCache({ namespace: "symbaiex-indexnow" });
let durableStateLoaded = false;
let durableStateLoad: Promise<void> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Notify IndexNow without ever making a publishing request fail. */
export async function notifyIndexNow(
  urls: readonly string[],
  options: IndexNowOptions = {},
): Promise<void> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !isSafeKey(key)) return;

  await loadDurableIndexNowState();

  const validUrls = normalizeUrls(urls).slice(0, INDEXNOW_MAX_URLS);
  if (validUrls.length === 0) return;

  pruneExpiredIndexNowDedup();

  const byHost = new Map<string, string[]>();
  for (const url of validUrls) {
    const parsed = new URL(url);
    const hostUrls = byHost.get(parsed.host) ?? [];
    hostUrls.push(url);
    byHost.set(parsed.host, hostUrls);
  }

  await Promise.all(
    [...byHost.entries()].map(async ([host, urlList]) => {
      const context = options.context;
      const dedupeKey = buildDedupeKey({
        host,
        urls: urlList,
        context,
      });
      const now = Date.now();

      if (isInFlightDedupeWindow(dedupeKey, now)) {
        indexNowAudit.push({
          dedupeKey,
          host,
          status: "skipped",
          source: context?.source,
          action: context?.action,
          resourceId: context?.resourceId,
          urlCount: urlList.length,
          attempts: 0,
          createdAt: now,
        });
        trimAudit();
        await persistDurableIndexNowState();
        return;
      }

      const payload: IndexNowPayload = {
        host,
        key,
        keyLocation: `https://${host}/indexnow-${key}.txt`,
        urlList,
      };
      indexNowDedup.set(dedupeKey, {
        dedupeUntil: now + INDEXNOW_IDEMPOTENCY_WINDOW_MS,
      });
      indexNowAudit.push({
        dedupeKey,
        host,
        status: "queued",
        source: context?.source,
        action: context?.action,
        resourceId: context?.resourceId,
        urlCount: urlList.length,
        attempts: 0,
        createdAt: now,
      });
      trimAudit();
      await persistDurableIndexNowState();

      let result: HostSubmissionResult;
      try {
        result = await notifyIndexNowWithRetry(payload);
        indexNowAudit.push({
          dedupeKey,
          host,
          status: result.succeeded ? "succeeded" : "failed",
          source: context?.source,
          action: context?.action,
          resourceId: context?.resourceId,
          urlCount: urlList.length,
          attempts: result.attempts,
          statusCode: result.statusCode,
          error: result.error,
          createdAt: Date.now(),
        });
        trimAudit();
        await persistDurableIndexNowState();
      } catch (error) {
        indexNowAudit.push({
          dedupeKey,
          host,
          status: "failed",
          source: context?.source,
          action: context?.action,
          resourceId: context?.resourceId,
          urlCount: urlList.length,
          attempts: 1,
          error: stringifyError(error),
          createdAt: Date.now(),
        });
        trimAudit();
        await persistDurableIndexNowState();
        console.warn("IndexNow submission failed");
        return;
      }

      if (result.succeeded) return;

      console.warn("IndexNow submission failed", {
        status: result.statusCode,
        attempts: result.attempts,
        host,
      });
    }),
  );
}

export function getIndexNowAuditSnapshot() {
  return [...indexNowAudit];
}

export function resetIndexNowAuditForTests() {
  indexNowAudit.length = 0;
  indexNowDedup.clear();
  durableStateLoaded = false;
  durableStateLoad = null;
}

/**
 * Vercel Runtime Cache provides a shared, best-effort durable layer for the
 * short idempotency window and bounded audit trail. The in-memory maps remain
 * the local fast path and the feature still fails closed when the cache is not
 * available (for example in local tests).
 */
async function loadDurableIndexNowState() {
  if (process.env.VERCEL !== "1" || durableStateLoaded) return;
  if (durableStateLoad) return durableStateLoad;

  durableStateLoad = (async () => {
    try {
      const state = (await indexNowRuntimeCache.get(
        INDEXNOW_RUNTIME_CACHE_KEY,
      )) as {
        dedupe?: Record<string, IndexNowSubmissionState>;
        audit?: IndexNowAuditRecord[];
      } | null;

      for (const [dedupeKey, entry] of Object.entries(state?.dedupe ?? {})) {
        if (entry && Number.isFinite(entry.dedupeUntil)) {
          indexNowDedup.set(dedupeKey, entry);
        }
      }
      for (const record of state?.audit ?? []) {
        if (isValidAuditRecord(record)) indexNowAudit.push(record);
      }
      trimAudit();
    } catch {
      // Runtime Cache is an optimization and audit durability aid; never make
      // a content publish fail because the optional cache is unavailable.
    } finally {
      durableStateLoaded = true;
      durableStateLoad = null;
    }
  })();

  return durableStateLoad;
}

async function persistDurableIndexNowState() {
  if (process.env.VERCEL !== "1") return;

  try {
    const dedupe = Object.fromEntries(indexNowDedup.entries());
    await indexNowRuntimeCache.set(
      INDEXNOW_RUNTIME_CACHE_KEY,
      { dedupe, audit: indexNowAudit.slice(-INDEXNOW_MAX_AUDIT_ENTRIES) },
      {
        name: "symbaiex:indexnow-state",
        tags: ["symbaiex-indexnow"],
        ttl: INDEXNOW_RUNTIME_CACHE_TTL_SECONDS,
      },
    );
  } catch {
    // Best effort by design. The external publisher remains fail-closed.
  }
}

function isValidAuditRecord(record: unknown): record is IndexNowAuditRecord {
  if (!record || typeof record !== "object") return false;
  const candidate = record as Partial<IndexNowAuditRecord>;
  return (
    typeof candidate.dedupeKey === "string" &&
    typeof candidate.host === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.urlCount === "number" &&
    typeof candidate.attempts === "number" &&
    typeof candidate.createdAt === "number"
  );
}

function isInFlightDedupeWindow(dedupeKey: string, now: number) {
  const state = indexNowDedup.get(dedupeKey);
  return state !== undefined && state.dedupeUntil > now;
}

function buildDedupeKey(args: {
  host: string;
  urls: readonly string[];
  context?: IndexNowEventContext;
}) {
  const normalized = [...args.urls].sort().join("|");
  return [
    args.host,
    normalized,
    args.context?.source ?? "unknown",
    args.context?.action ?? "unspecified",
    args.context?.resourceId ?? "n/a",
  ].join("::");
}

function pruneExpiredIndexNowDedup() {
  const now = Date.now();
  for (const [key, state] of indexNowDedup.entries()) {
    if (state.dedupeUntil <= now) {
      indexNowDedup.delete(key);
    }
  }
}

async function notifyIndexNowWithRetry(
  payload: IndexNowPayload,
): Promise<HostSubmissionResult> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= INDEXNOW_MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(INDEXNOW_TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (response.ok) {
        return {
          succeeded: true,
          attempts: attempt,
          statusCode: response.status,
        };
      }

      lastError = `non-ok:${response.status}`;
      if (
        !isRetryableStatus(response.status) ||
        attempt >= INDEXNOW_MAX_RETRY_ATTEMPTS
      ) {
        return {
          succeeded: false,
          attempts: attempt,
          statusCode: response.status,
          error: lastError,
        };
      }
    } catch (error) {
      lastError = stringifyError(error);
      if (attempt >= INDEXNOW_MAX_RETRY_ATTEMPTS) {
        return {
          succeeded: false,
          attempts: attempt,
          error: lastError,
        };
      }
    }

    await sleep(INDEXNOW_RETRY_DELAY_MS * 2 ** (attempt - 1));
  }

  return {
    succeeded: false,
    attempts: INDEXNOW_MAX_RETRY_ATTEMPTS,
    statusCode: lastStatus,
    error: lastError,
  };
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status >= 502;
}

function trimAudit() {
  while (indexNowAudit.length > INDEXNOW_MAX_AUDIT_ENTRIES) {
    indexNowAudit.shift();
  }
}

function stringifyError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return "unknown error";
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
