import "server-only";

import { getCache } from "@vercel/functions";

type ServerCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

type RuntimeCacheEntry<T> = {
  value: T;
};

const MAX_SERVER_CACHE_ENTRIES = 200;
const serverCache = new Map<string, ServerCacheEntry<unknown>>();
const runtimeCache = getCache({ namespace: "symbaiex-server" });

/**
 * Keep a tiny per-instance L1 cache for request coalescing, then use Vercel's
 * Runtime Cache as the shared L2 when running on Vercel. Runtime Cache is
 * intentionally optional locally: development and tests retain deterministic
 * in-memory behavior without requiring platform-only cache credentials.
 */
async function loadFromRuntimeCache<T>(key: string): Promise<T | undefined> {
  if (process.env.VERCEL !== "1") {
    return undefined;
  }

  const entry = (await runtimeCache.get(key)) as RuntimeCacheEntry<T> | null;
  return entry && "value" in entry ? entry.value : undefined;
}

async function saveToRuntimeCache<T>(key: string, value: T, ttlMs: number) {
  if (process.env.VERCEL !== "1") {
    return;
  }

  await runtimeCache.set(
    key,
    { value },
    {
      name: `symbaiex:${key}`,
      tags: ["symbaiex-server-data"],
      ttl: Math.max(1, Math.ceil(ttlMs / 1_000)),
    },
  );
}

export function readThroughServerCache<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = serverCache.get(key) as ServerCacheEntry<T> | undefined;

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const remoteValue = await loadFromRuntimeCache<T>(key);
    if (remoteValue !== undefined) {
      return remoteValue;
    }

    const value = await load();
    await saveToRuntimeCache(key, value, ttlMs);
    return value;
  })().catch((error) => {
    const current = serverCache.get(key);
    if (current?.promise === promise) {
      serverCache.delete(key);
    }
    throw error;
  });

  serverCache.set(key, {
    expiresAt: now + ttlMs,
    promise,
  });

  if (serverCache.size > MAX_SERVER_CACHE_ENTRIES) {
    const oldestKey = serverCache.keys().next().value;
    if (oldestKey) {
      serverCache.delete(oldestKey);
    }
  }

  return promise;
}
