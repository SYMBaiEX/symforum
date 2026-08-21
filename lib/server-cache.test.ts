import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { invalidateServerCache, readThroughServerCache } from "./server-cache";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server cache", () => {
  test("coalesces concurrent loads within the local cache window", async () => {
    vi.stubEnv("VERCEL", "");
    let loads = 0;
    const key = `test:coalesce:${crypto.randomUUID()}`;
    const load = async () => {
      loads += 1;
      await Promise.resolve();
      return { value: "cached" };
    };

    const [first, second] = await Promise.all([
      readThroughServerCache(key, 1_000, load),
      readThroughServerCache(key, 1_000, load),
    ]);

    expect(first).toEqual({ value: "cached" });
    expect(second).toEqual({ value: "cached" });
    expect(loads).toBe(1);
  });

  test("does not retain rejected loads", async () => {
    vi.stubEnv("VERCEL", "");
    const key = `test:failure:${crypto.randomUUID()}`;
    let attempts = 0;

    await expect(
      readThroughServerCache(key, 1_000, async () => {
        attempts += 1;
        throw new Error("temporary failure");
      }),
    ).rejects.toThrow("temporary failure");

    await expect(
      readThroughServerCache(key, 1_000, async () => {
        attempts += 1;
        return "recovered";
      }),
    ).resolves.toBe("recovered");

    expect(attempts).toBe(2);
  });

  test("invalidates a local cached value before the next read", async () => {
    vi.stubEnv("VERCEL", "");
    const key = `test:invalidate:${crypto.randomUUID()}`;
    let value = "before";
    const load = async () => value;

    await expect(readThroughServerCache(key, 60_000, load)).resolves.toBe("before");
    value = "after";
    await expect(readThroughServerCache(key, 60_000, load)).resolves.toBe("before");

    await invalidateServerCache(key);

    await expect(readThroughServerCache(key, 60_000, load)).resolves.toBe("after");
  });
});
