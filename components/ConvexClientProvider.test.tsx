import { describe, expect, test } from "vitest";

import {
  CONVEX_QUERY_CACHE_EXPIRATION_MS,
  CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES,
} from "@symbaiex/auth/query-cache";

describe("ConvexClientProvider query cache", () => {
  test("bounds idle retention without changing live subscriptions", () => {
    expect(CONVEX_QUERY_CACHE_EXPIRATION_MS).toBe(60_000);
    expect(CONVEX_QUERY_CACHE_MAX_IDLE_ENTRIES).toBeLessThanOrEqual(80);
  });
});
