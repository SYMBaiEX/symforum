import { getFunctionName, type FunctionReference } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import { afterEach, expect, test, vi } from "vitest";
import {
  ProviderAdmissionError,
  providerFetch,
  type ProviderAdmission,
} from "./forumProviderFetch";

const RPC = "https://mainnet.helius-rpc.com/?api-key=not-a-real-key";
const INDEPENDENT = "https://rpc.ankr.com/solana";
const jsonRpc = (method = "getBalance") => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: ["public-wallet"],
  }),
});
function setup(ok = true) {
  const response = new Response("{}", { status: 200 });
  const fetcher = vi.fn<typeof fetch>(async () => response);
  const runMutation = vi.fn(
    async (
      _reference: FunctionReference<"mutation">,
      _args: unknown,
    ): Promise<ProviderAdmission> =>
      ok
        ? { ok: true as const, reason: null, retryAt: null }
        : { ok: false as const, reason: "burst" as const, retryAt: 12345 },
  );
  return {
    fetcher,
    runMutation,
    response,
    read: providerFetch(
      { runMutation } as unknown as Pick<ActionCtx, "runMutation">,
      {
        rpcUrls: [RPC, INDEPENDENT],
        fetcher,
      },
    ),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  ["https://api.dexscreener.com/token-pairs/v1/solana/mint", "dexscreener"],
  [
    "https://api.geckoterminal.com/api/v2/networks/solana/pools/pool/trades",
    "geckoterminal",
  ],
])("admits %s once before unchanged transport", async (url, provider) => {
  const t = setup();
  const init = {
    headers: { accept: "application/json" },
    redirect: "error" as const,
  };
  expect(await t.read(url, init)).toBe(t.response);
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(t.runMutation.mock.calls[0]![0]!)).toBe(
    "forumProviderAdmission:admit",
  );
  expect(t.runMutation.mock.calls[0]?.[1]).toEqual({ provider, credits: 1 });
  expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(url, init);
  expect(t.runMutation.mock.invocationCallOrder[0]).toBeLessThan(
    t.fetcher.mock.invocationCallOrder[0]!,
  );
});

test.each([RPC, INDEPENDENT])(
  "meters configured RPC without changing exact independent endpoint",
  async (url) => {
    const t = setup();
    const init = jsonRpc();
    expect(await t.read(url, init)).toBe(t.response);
    expect(t.runMutation.mock.calls[0]?.[1]).toEqual({
      provider: "helius",
      credits: 1,
    });
    expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(url, init);
  },
);

test.each([
  "https://api.jup.ag/swap/v2/execute",
  "https://lite-api.jup.ag/tokens/v2/search?query=SOL",
  "https://data.solanatracker.io/price?token=mint",
  "https://api.telegram.org/bot-fake/sendMessage",
  "https://api.dexscreener.com.attacker.invalid/token",
])(
  "leaves existing unrelated policy/transport at %s unchanged",
  async (url) => {
    const t = setup(false);
    expect(await t.read(url)).toBe(t.response);
    expect(t.runMutation).not.toHaveBeenCalled();
    expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(url, undefined);
  },
);

test("denial is safe, occurs before I/O and never retries", async () => {
  const t = setup(false);
  const error = await t.read(RPC, jsonRpc()).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderAdmissionError);
  expect(error).toMatchObject({
    code: "provider_admission_denied",
    provider: "helius",
    reason: "burst",
    retryAt: 12345,
  });
  expect(t.fetcher).not.toHaveBeenCalled();
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(error)).not.toContain("not-a-real-key");
  expect(String(error)).not.toContain("public-wallet");
});

test("failed I/O stays charged once and is not retried", async () => {
  const t = setup();
  const failure = new Error("inert failure");
  t.fetcher.mockRejectedValueOnce(failure);
  await expect(t.read(RPC, jsonRpc())).rejects.toBe(failure);
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(t.fetcher).toHaveBeenCalledTimes(1);
});

test("upstream 429 response is returned untouched, with no replay", async () => {
  const t = setup();
  const denied = new Response("inert private provider text", {
    status: 429,
    headers: { "Retry-After": "300" },
  });
  t.fetcher.mockResolvedValueOnce(denied);
  expect(await t.read(RPC, jsonRpc())).toBe(denied);
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(t.fetcher).toHaveBeenCalledTimes(1);
});

test.each([
  { ...jsonRpc(), body: "{" },
  { ...jsonRpc(), body: "[]" },
  {
    ...jsonRpc(),
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    ]),
  },
  {
    ...jsonRpc(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "unknown",
      params: [],
    }),
  },
  {
    ...jsonRpc(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getProgramAccounts",
      params: [],
    }),
  },
  {
    ...jsonRpc(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: {},
    }),
  },
  {
    ...jsonRpc(),
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: 1,
      method: "getBalance",
      params: [],
    }),
  },
  {
    ...jsonRpc(),
    body: JSON.stringify({ jsonrpc: "2.0", method: "getBalance", params: [] }),
  },
  { ...jsonRpc(), body: new URLSearchParams("method=getBalance") },
  { ...jsonRpc(), body: "x".repeat(2_000_001) },
  { ...jsonRpc(), method: "GET" },
  {},
])(
  "unknown/malformed RPC cannot receive an assumed one-credit cost %#",
  async (init) => {
    const t = setup();
    await expect(t.read(RPC, init)).rejects.toMatchObject({
      reason: "invalid-request",
      retryAt: null,
    });
    expect(t.runMutation).not.toHaveBeenCalled();
    expect(t.fetcher).not.toHaveBeenCalled();
  },
);

test.each([
  "http://api.dexscreener.com/path",
  "https://user:secret@api.dexscreener.com/path",
  "https://api.geckoterminal.com:444/path",
  "https://api.geckoterminal.com/path#fragment",
])(
  "malformed allowlisted provider URL is denied before I/O: %s",
  async (url) => {
    const t = setup();
    await expect(t.read(url)).rejects.toMatchObject({
      reason: "invalid-request",
    });
    expect(t.runMutation).not.toHaveBeenCalled();
    expect(t.fetcher).not.toHaveBeenCalled();
  },
);

test("URL and Request inputs use exact host classification without consuming their bodies", async () => {
  const t = setup();
  const url = new URL("https://api.dexscreener.com/token-pairs/v1/solana/mint");
  await t.read(url);
  const request = new Request("https://api.geckoterminal.com/api/v2/path");
  await t.read(request);
  expect(t.runMutation).toHaveBeenCalledTimes(2);
  expect(t.fetcher.mock.calls[0]?.[0]).toBe(url);
  expect(t.fetcher.mock.calls[1]?.[0]).toBe(request);
  expect(request.bodyUsed).toBe(false);
});

test("Request RPC without explicit bounded JSON body fails closed", async () => {
  const t = setup();
  const request = new Request(RPC, jsonRpc());
  await expect(t.read(request)).rejects.toMatchObject({
    reason: "invalid-request",
  });
  expect(request.bodyUsed).toBe(false);
  expect(t.fetcher).not.toHaveBeenCalled();
});

test("RPC burst waits before its first and only I/O, retaining exact request and signal", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation.mockResolvedValueOnce({
    ok: false,
    reason: "burst",
    retryAt: 102000,
  });
  const signal = new AbortController().signal;
  const init = { ...jsonRpc(), signal };
  const pending = t.read(RPC, init);
  await vi.advanceTimersByTimeAsync(1999);
  expect(t.fetcher).not.toHaveBeenCalled();
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(t.response);
  expect(t.runMutation).toHaveBeenCalledTimes(2);
  expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(RPC, init);
});

test("RPC abort while waiting performs no I/O and no additional admission", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation.mockResolvedValueOnce({
    ok: false,
    reason: "burst",
    retryAt: 102000,
  });
  const controller = new AbortController();
  const pending = t
    .read(RPC, { ...jsonRpc(), signal: controller.signal })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  const reason = new Error("caller aborted before I/O");
  controller.abort(reason);
  expect(await pending).toBe(reason);
  await vi.advanceTimersByTimeAsync(2000);
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(t.fetcher).not.toHaveBeenCalled();
});

test("already aborted caller performs no admission or transport", async () => {
  const t = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    t.read(RPC, { ...jsonRpc(), signal: controller.signal }),
  ).rejects.toThrow();
  expect(t.runMutation).not.toHaveBeenCalled();
  expect(t.fetcher).not.toHaveBeenCalled();
});

test("abort during successful admission is checked before transport", async () => {
  const t = setup();
  const controller = new AbortController();
  t.runMutation.mockImplementationOnce(async () => {
    controller.abort();
    return { ok: true, reason: null, retryAt: null };
  });
  await expect(
    t.read(RPC, { ...jsonRpc(), signal: controller.signal }),
  ).rejects.toThrow();
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(t.fetcher).not.toHaveBeenCalled();
});

test.each(["daily", "rolling"] as const)(
  "RPC %s denial never waits or checks again",
  async (reason) => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const t = setup();
    t.runMutation.mockResolvedValueOnce({ ok: false, reason, retryAt: 101000 });
    await expect(t.read(RPC, jsonRpc())).rejects.toMatchObject({
      reason,
      retryAt: 101000,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(t.runMutation).toHaveBeenCalledTimes(1);
    expect(t.fetcher).not.toHaveBeenCalled();
  },
);

test.each([
  "https://api.dexscreener.com/path",
  "https://api.geckoterminal.com/path",
])("non-RPC burst at %s never waits", async (url) => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation.mockResolvedValueOnce({
    ok: false,
    reason: "burst",
    retryAt: 101000,
  });
  await expect(t.read(url)).rejects.toMatchObject({ reason: "burst" });
  expect(vi.getTimerCount()).toBe(0);
  expect(t.runMutation).toHaveBeenCalledTimes(1);
  expect(t.fetcher).not.toHaveBeenCalled();
});

test.each([99999, 102001])(
  "RPC invalid/out-of-bound retry deadline %i denies immediately",
  async (retryAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const t = setup();
    t.runMutation.mockResolvedValueOnce({
      ok: false,
      reason: "burst",
      retryAt,
    });
    await expect(t.read(RPC, jsonRpc())).rejects.toMatchObject({
      reason: "burst",
      retryAt,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(t.runMutation).toHaveBeenCalledTimes(1);
  },
);

test("RPC rechecks at most twice, even when its total wait remains below the budget", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation.mockImplementation(async () => ({
    ok: false,
    reason: "burst",
    retryAt: Date.now() + 1000,
  }));
  const pending = t.read(RPC, jsonRpc()).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toMatchObject({ reason: "burst", retryAt: 103000 });
  expect(t.runMutation).toHaveBeenCalledTimes(3);
  expect(t.fetcher).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("RPC total wait cannot exceed 2500ms, with no upstream request started", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation
    .mockResolvedValueOnce({ ok: false, reason: "burst", retryAt: 102000 })
    .mockResolvedValueOnce({ ok: false, reason: "burst", retryAt: 103000 });
  const pending = t.read(RPC, jsonRpc()).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toMatchObject({ reason: "burst", retryAt: 103000 });
  expect(t.runMutation).toHaveBeenCalledTimes(2);
  expect(t.fetcher).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("post-admission I/O failure is never retried, even after a bounded wait", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  t.runMutation.mockResolvedValueOnce({
    ok: false,
    reason: "burst",
    retryAt: 101000,
  });
  t.fetcher.mockRejectedValueOnce(new Error("inert uncertain transport"));
  const pending = t.read(RPC, jsonRpc()).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ message: "inert uncertain transport" });
  expect(t.runMutation).toHaveBeenCalledTimes(2);
  expect(t.fetcher).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("only exact JSON sendTransaction sets the method-specific admission flag", async () => {
  const t = setup();
  const init = jsonRpc("sendTransaction");
  expect(await t.read(RPC, init)).toBe(t.response);
  expect(t.runMutation.mock.calls[0]?.[1]).toEqual({
    provider: "helius",
    credits: 1,
    sendTransaction: true,
  });
  expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(RPC, init);
  await t.read(RPC, jsonRpc("getTransaction"));
  expect(t.runMutation.mock.calls[1]?.[1]).toEqual({
    provider: "helius",
    credits: 1,
  });
  await t.read("https://api.dexscreener.com/sendTransaction");
  expect(t.runMutation.mock.calls[2]?.[1]).toEqual({
    provider: "dexscreener",
    credits: 1,
  });
});

test("method-specific burst wait retains the flag and never retries a subsequent I/O failure", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const t = setup();
  const init = jsonRpc("sendTransaction");
  t.runMutation.mockResolvedValueOnce({
    ok: false,
    reason: "burst",
    retryAt: 102000,
  });
  t.fetcher.mockRejectedValueOnce(new Error("inert unknown transport outcome"));
  const work = t.read(RPC, init).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await work).toMatchObject({
    message: "inert unknown transport outcome",
  });
  expect(t.runMutation).toHaveBeenCalledTimes(2);
  for (const call of t.runMutation.mock.calls)
    expect(call[1]).toEqual({
      provider: "helius",
      credits: 1,
      sendTransaction: true,
    });
  expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(RPC, init);
  expect(vi.getTimerCount()).toBe(0);
});
