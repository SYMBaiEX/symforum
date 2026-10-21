import { afterEach, describe, expect, test, vi } from "vitest";
import { verifySolanaMints } from "./solana-mint-validation";

const FIRST = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const SECOND = "CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump";
const SYSVAR_RENT = "SysvarRent111111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_ID = "symbaiex-token-mint-validation";
const FAILURE = "Solana mint verification failed; no retry was attempted.";

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
      "https://api.mainnet-beta.solana.com",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
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
      setup([value]);
      expect(await verifySolanaMints([FIRST])).toEqual(new Set());
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

  test("fails HTTP, network, parse and redirect errors without body leakage or retries", async () => {
    const fetch = setup();
    const secret = "secret-body-do-not-publish";
    for (const response of [
      new Response(secret, { status: 429 }),
      new Response(secret),
      new Response(secret, {
        status: 302,
        headers: { location: "https://evil.com" },
      }),
    ]) {
      fetch.mockResolvedValueOnce(response);
      await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
    }
    fetch.mockRejectedValueOnce(new Error(secret));
    await expect(verifySolanaMints([FIRST])).rejects.toThrow(FAILURE);
    expect(fetch).toHaveBeenCalledTimes(4);
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

  test("aborts the single request after ten seconds", async () => {
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
    const assertion = expect(verifySolanaMints([FIRST])).rejects.toThrow(
      FAILURE,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetch).toHaveBeenCalledOnce();
  });
});
