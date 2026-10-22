import { afterEach, describe, expect, test, vi } from "vitest";
import {
  verifySolanaMints,
  SolanaMintVerificationError,
} from "./solana-mint-validation";

const FIRST = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const SECOND = "CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump";
const SYSVAR_RENT = "SysvarRent111111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_ID = "symbaiex-token-mint-validation";
const FAILURE = "Solana mint verification failed.";

function account(overrides: Record<string, unknown> = {}) {
  return {
    executable: false,
    owner: TOKEN,
    data: {
      program: "spl-token",
      parsed: {
        type: "mint",
        info: { isInitialized: true, decimals: 6, supply: "1000000000000000" },
      },
      space: 82,
    },
    ...overrides,
  };
}

function setup(values: unknown[] = [account()]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  fetch.mockResolvedValue(
    Response.json({
      jsonrpc: "2.0",
      id: RPC_ID,
      result: { context: { slot: 350_000_000 }, value: values },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function info(overrides: Record<string, unknown>) {
  return account({
    data: {
      program: "spl-token",
      parsed: {
        type: "mint",
        info: {
          isInitialized: true,
          decimals: 6,
          supply: "1000",
          ...overrides,
        },
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("finalized on-chain Solana mint verification", () => {
  test("makes one keyless finalized jsonParsed batch request and accepts a parsed initialized mint", async () => {
    const fetch = setup();
    expect(await verifySolanaMints([FIRST])).toEqual(new Set([FIRST]));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://solana-rpc.publicnode.com",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        signal: expect.any(AbortSignal),
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
      }),
    );
    const init = fetch.mock.calls[0][1];
    expect(JSON.parse(init!.body as string)).toEqual({
      jsonrpc: "2.0",
      id: RPC_ID,
      method: "getMultipleAccounts",
      params: [[FIRST], { commitment: "finalized", encoding: "jsonParsed" }],
    });
  });

  test("supports both exact token programs, including parsed Token-2022 extensions", async () => {
    setup([
      account(),
      account({
        owner: TOKEN_2022,
        data: {
          program: "spl-token-2022",
          parsed: {
            type: "mint",
            info: {
              isInitialized: true,
              decimals: 9,
              supply: "18446744073709551615",
              extensions: [{ extension: "metadataPointer" }],
            },
          },
          space: 234,
        },
      }),
    ]);
    expect(await verifySolanaMints([FIRST, SECOND])).toEqual(
      new Set([FIRST, SECOND]),
    );
  });

  test("rejects the Sysvar Rent spoof despite provider-like mint fields", async () => {
    setup([account({ owner: "Sysvar1111111111111111111111111111111111111" })]);
    expect(await verifySolanaMints([SYSVAR_RENT])).toEqual(new Set());
  });

  test.each([
    null,
    account({ owner: "11111111111111111111111111111111" }),
    account({ executable: true }),
    account({ executable: undefined }),
    account({ data: ["AA==", "base64"] }),
    account({
      data: {
        program: "spl-token",
        parsed: {
          type: "account",
          info: { isInitialized: true, decimals: 6, supply: "1000" },
        },
      },
    }),
    account({
      data: {
        program: "spl-token",
        parsed: {
          type: "multisig",
          info: { isInitialized: true, decimals: 6, supply: "1000" },
        },
      },
    }),
    account({
      data: {
        program: "spl-token-2022",
        parsed: {
          type: "mint",
          info: { isInitialized: true, decimals: 6, supply: "1000" },
        },
      },
    }),
    account({ data: { parsed: { type: "mint" } } }),
    info({ isInitialized: false }),
    info({ isInitialized: "true" }),
    info({ decimals: -1 }),
    info({ decimals: 19 }),
    info({ decimals: 1.5 }),
    info({ decimals: "6" }),
    info({ supply: "-1" }),
    info({ supply: "1.5" }),
    info({ supply: "1e6" }),
    info({ supply: "" }),
    info({ supply: "01" }),
    info({ supply: "18446744073709551616" }),
    info({ supply: 1000 }),
    info({ supply: null }),
  ])(
    "excludes missing, wrong-program, non-mint, uninitialized or malformed mint state: %#",
    async (value) => {
      const fetch = setup([value]);
      expect(await verifySolanaMints([FIRST])).toEqual(new Set());
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  test("maps nulls and valid accounts to the exact request order, not another mint", async () => {
    setup([null, account()]);
    expect(await verifySolanaMints([FIRST, SECOND])).toEqual(new Set([SECOND]));
  });

  test("deduplicates exact mints without changing request order", async () => {
    const fetch = setup([account(), null]);
    expect(await verifySolanaMints([SECOND, FIRST, SECOND])).toEqual(
      new Set([SECOND]),
    );
    expect(
      JSON.parse(fetch.mock.calls[0][1]!.body as string).params[0],
    ).toEqual([SECOND, FIRST]);
  });

  test("empty input needs no RPC; malformed or oversized input fails before a request", async () => {
    const fetch = setup();
    expect(await verifySolanaMints([])).toEqual(new Set());
    for (const mints of [
      ["bad"],
      ["A".repeat(32)],
      Array(6).fill(FIRST),
      [`${FIRST} `],
    ]) {
      await expect(verifySolanaMints(mints)).rejects.toThrow(FAILURE);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    {
      jsonrpc: "2.0",
      id: "wrong",
      result: { context: { slot: 1 }, value: [account()] },
    },
    {
      jsonrpc: "1.0",
      id: RPC_ID,
      result: { context: { slot: 1 }, value: [account()] },
    },
    { jsonrpc: "2.0", id: RPC_ID, error: { message: "private failure" } },
    { jsonrpc: "2.0", id: RPC_ID, result: { value: [account()] } },
    {
      jsonrpc: "2.0",
      id: RPC_ID,
      result: { context: { slot: "1" }, value: [account()] },
    },
    {
      jsonrpc: "2.0",
      id: RPC_ID,
      result: { context: { slot: -1 }, value: [account()] },
    },
    { jsonrpc: "2.0", id: RPC_ID, result: { context: { slot: 1 }, value: [] } },
    {
      jsonrpc: "2.0",
      id: RPC_ID,
      result: { context: { slot: 1 }, value: [account(), account()] },
    },
  ])(
    "fails closed for an invalid or uncorrelated RPC envelope: %#",
    async (value) => {
      const fetch = setup();
      fetch.mockResolvedValueOnce(Response.json(value));
      await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  test("fails permanent HTTP, parse and redirect errors without body leakage or retries", async () => {
    const fetch = setup();
    const secret = "secret-body-do-not-publish";
    for (const response of [
      new Response(secret, { status: 403 }),
      new Response(secret),
      new Response(secret, {
        status: 302,
        headers: { location: "https://evil.com" },
      }),
    ]) {
      fetch.mockResolvedValueOnce(response);
      await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test.each([429, 500, 503])(
    "allows only one bounded retry for transient HTTP %s",
    async (status) => {
      const fetch = setup();
      fetch.mockResolvedValueOnce(
        new Response("private response", {
          status,
          headers: { "retry-after": "0" },
        }),
      );
      expect(await verifySolanaMints([FIRST])).toEqual(new Set([FIRST]));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
      expect(fetch.mock.calls[1][1]!.body).toBe(fetch.mock.calls[0][1]!.body);
    },
  );

  test("network failures are retried once then classified without raw text", async () => {
    const fetch = setup();
    fetch.mockRejectedValue(new Error("private response"));
    const assertion = verifySolanaMints([FIRST]);
    await expect(assertion).rejects.toBeInstanceOf(SolanaMintVerificationError);
    await expect(assertion).rejects.toMatchObject({
      code: "network",
      message: FAILURE,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("repeated transient HTTP errors stop after the second request", async () => {
    const fetch = setup();
    fetch.mockResolvedValue(
      new Response("private body", {
        status: 429,
        headers: { "retry-after": "0" },
      }),
    );
    const result = verifySolanaMints([FIRST]);
    await expect(result).rejects.toMatchObject({
      code: "http-429",
      message: FAILURE,
    });
    const error = await result.catch((value: unknown) => value);
    expect(JSON.stringify(error)).not.toContain("private body");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a Retry-After beyond two seconds prevents a retry", async () => {
    const fetch = setup();
    fetch.mockResolvedValueOnce(
      new Response("private response", {
        status: 429,
        headers: { "retry-after": "3" },
      }),
    );
    await expect(verifySolanaMints([FIRST])).rejects.toMatchObject({
      code: "http-429",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("waits the whole valid HTTP-date Retry-After before retrying", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 9, 21, 21);
    vi.setSystemTime(now);
    const fetch = setup();
    fetch.mockResolvedValueOnce(
      new Response("private response", {
        status: 503,
        headers: { "retry-after": new Date(now + 2_000).toUTCString() },
      }),
    );
    const result = verifySolanaMints([FIRST]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual(new Set([FIRST]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("rejects response redirects even when a fetch implementation resolves them", async () => {
    const fetch = setup();
    const response = Response.json({});
    Object.defineProperty(response, "redirected", { value: true });
    fetch.mockResolvedValueOnce(response);
    await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
  });

  test("enforces both declared and streamed 256 KiB limits", async () => {
    const fetch = setup();
    fetch.mockResolvedValueOnce(
      new Response("{}", { headers: { "content-length": "262145" } }),
    );
    await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
    fetch.mockResolvedValueOnce(new Response(" ".repeat(262_145)));
    await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
  });

  test("aborts each request after ten seconds with at most one timeout retry", async () => {
    vi.useFakeTimers();
    const fetch = setup();
    fetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const assertion = expect(verifySolanaMints([FIRST])).rejects.toMatchObject({
      code: "timeout",
      message: FAILURE,
    });
    await vi.advanceTimersByTimeAsync(20_250);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
