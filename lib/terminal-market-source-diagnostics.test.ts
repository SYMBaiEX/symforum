import { afterEach, describe, expect, test, vi } from "vitest";
import { PublicMarketSourceError } from "./chart-cache-policy";
import { readPublicMarket } from "./terminal-market-source";

const NOW = Date.parse("2026-10-30T22:00:00Z");
const URL = "https://api.geckoterminal.com/api/v2/private-query-marker";
const PRIVATE = "PRIVATE_PROVIDER_BODY_OR_ERROR";

afterEach(() => vi.useRealTimers());

async function failure(task: Promise<unknown>, code: string) {
  const result = await task.then(
    () => null,
    (error) => error,
  );
  expect(result).toBeInstanceOf(PublicMarketSourceError);
  expect(result.code).toBe(code);
  for (const rendered of [
    String(result),
    JSON.stringify(result),
    result.stack,
  ]) {
    expect(rendered).not.toContain(PRIVATE);
    expect(rendered).not.toContain(URL);
    expect(rendered).not.toContain("private-query-marker");
  }
  return result as PublicMarketSourceError;
}

function responseStream(body: Uint8Array, headers?: HeadersInit, status = 200) {
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
      },
      cancel,
    }),
    { status, headers },
  );
  return { response, cancel };
}

describe("public market safe transport diagnostics", () => {
  test("one bounded allowlisted request returns JSON with redirect and timeout guards", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    expect(await readPublicMarket(URL, 100, fetcher)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(URL, {
      headers: { Accept: "application/json" },
      signal: expect.any(AbortSignal),
      redirect: "error",
    });
  });

  test.each(["TimeoutError", "AbortError", "TypeError"])(
    "%s is classified without leaking or retrying",
    async (name) => {
      const fetcher = vi.fn(async () => {
        throw Object.assign(new Error(`${PRIVATE} ${URL}`), { name });
      });
      const result = await failure(
        readPublicMarket(URL, 100, fetcher),
        name === "TypeError" ? "network" : "timeout",
      );
      expect(result.retryAfterAt).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    [429, "http-429"],
    [403, "http-4xx"],
    [503, "http-5xx"],
  ] as const)(
    "HTTP %s is safe, charged once and cancels its unread body",
    async (status, code) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const { response, cancel } = responseStream(
        new TextEncoder().encode(PRIVATE),
        { "Retry-After": "120" },
        status,
      );
      const fetcher = vi.fn(async () => response);
      const result = await failure(readPublicMarket(URL, 100, fetcher), code);
      expect(result.retryAfterAt).toBe(
        status === 429 || status === 503 ? NOW + 120_000 : null,
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["120", "invalid-private-hint", "Fri, 30 Oct 2026 22:02:00 GMT"])(
    "429 hint %s is parsed or discarded without retaining raw headers",
    async (hint) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const fetcher = vi.fn(
        async () =>
          new Response(PRIVATE, {
            status: 429,
            headers: { "Retry-After": hint },
          }),
      );
      const result = await failure(
        readPublicMarket(URL, 100, fetcher),
        "http-429",
      );
      expect(result.retryAfterAt).toBe(
        hint === "invalid-private-hint" ? null : NOW + 120_000,
      );
      expect(JSON.stringify(result)).not.toContain(hint);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["101", "not-a-byte-count"])(
    "oversized or invalid content length %s cancels before buffering",
    async (length) => {
      const { response, cancel } = responseStream(
        new TextEncoder().encode(PRIVATE),
        { "content-length": length },
      );
      const fetcher = vi.fn(async () => response);
      await failure(readPublicMarket(URL, 100, fetcher), "invalid-response");
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test("streamed bytes over the limit cancel even without content length", async () => {
    const { response, cancel } = responseStream(new Uint8Array(101));
    const fetcher = vi.fn(async () => response);
    await failure(readPublicMarket(URL, 100, fetcher), "invalid-response");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([new TextEncoder().encode(PRIVATE), new Uint8Array([0xff])])(
    "invalid JSON or UTF-8 fails closed without raw body",
    async (bytes) => {
      const fetcher = vi.fn(async () => new Response(bytes));
      await failure(readPublicMarket(URL, 100, fetcher), "invalid-response");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  test("a bodyless response is not treated as valid market data", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await failure(readPublicMarket(URL, 100, fetcher), "invalid-response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("unapproved provider URLs never invoke transport", async () => {
    const fetcher = vi.fn();
    await failure(
      readPublicMarket("https://private.example/secret", 100, fetcher),
      "unsupported",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
