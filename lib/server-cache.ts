type ServerCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const MAX_SERVER_CACHE_ENTRIES = 200;
const serverCache = new Map<string, ServerCacheEntry<unknown>>();

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

  const promise = load().catch((error) => {
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
