import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { TOKEN_2022_PROGRAM } from "../lib/forum-commerce";
import { ProviderAdmissionError } from "../lib/provider-admission-error";

const state = vi.hoisted(() => ({
  denied: false,
  denyAt: 0,
  upstream: vi.fn<typeof fetch>(),
  gate: vi.fn(),
}));
vi.mock("./forumProviderFetch", () => ({
  providerFetch: vi.fn(
    (_ctx: unknown, options: { rpcUrls: readonly string[] }) => {
      const wrapped: typeof fetch = async (input, init) => {
        state.gate(options.rpcUrls, JSON.parse(String(init?.body)).method);
        if (
          state.denied ||
          (state.denyAt > 0 && state.gate.mock.calls.length >= state.denyAt)
        )
          throw new ProviderAdmissionError("helius", "burst", null);
        return state.upstream(input, init);
      };
      return wrapped;
    },
  ),
}));
import { readTerminalWallet } from "./forumTerminalWallet";
import { inspectProvider, ExpiryCheckError } from "./forumSwapReconciliation";
import { providerFetch } from "./forumProviderFetch";
import { quotePromotion } from "./forumPromotions";
import { relay } from "./forumSwapSubmission";
import { signedSwapFixture } from "../tests/fixtures/signed-swap";
import { inspectSignedSwap } from "../lib/swap-signed-wire";

const files = [
  "forumTerminalWallet",
  "forumCommerceNode",
  "forumCommunityActions",
  "forumPromotions",
  "forumResearchActions",
  "forumSwaps",
  "forumSwapSubmission",
  "forumSwapRecovery",
  "forumSwapReconciliation",
  "forumCommerce",
];
const fetchArgument = new Map([
  ["commerceRpc", 4],
  ["commerceMint", 3],
  ["verifiedMint", 3],
  ["walletTokenAccount", 5],
  ["swapRpc", 4],
  ["getManagedOrder", 3],
  ["collectSwapQuotes", 3],
  ["buildPromotionTransaction", 4],
  ["inspectProvider", 4],
  ["signatureExpiry", 4],
  ["finalized", 3],
]);
test.each(files)(
  "%s passes explicit admitted fetchers at every RPC-capable call boundary",
  (name) => {
    const source = ts.createSourceFile(
      `${name}.ts`,
      readFileSync(`convex/${name}.ts`, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    let checked = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(source);
        const count =
          fetchArgument.get(text) ??
          (text.includes("prepareManagedSwap") &&
          text.includes("buildSwapTransaction")
            ? 3
            : undefined);
        if (count !== undefined) {
          checked++;
          expect(
            node.arguments.length,
            `${name}: ${text} missing explicit fetcher`,
          ).toBe(count);
          const last = node.arguments[count - 1].getText(source);
          expect(last, `${name}: ${text} bypasses admitted fetcher`).toMatch(
            /^(fetcher|providerFetch\()/,
          );
        }
        expect(
          text,
          `${name}: direct fetch bypasses central admission`,
        ).not.toBe("fetch");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(checked).toBeGreaterThan(0);
  },
);

const rpcUrl = "https://mainnet.helius-rpc.com/?api-key=invented";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
function context() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    runMutation: vi.fn(
      async (
        ref: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>,
      ) => {
        const name = getFunctionName(ref);
        calls.push({ name, args });
        if (name === "forumTerminalData:claimWalletRead")
          return { fetch: true, state: null };
        if (name === "forumTerminalData:saveWalletRead") return null;
        throw Error(`Unexpected mutation ${name}`);
      },
    ),
  } as unknown as ActionCtx;
  return { ctx, calls };
}
beforeEach(() => {
  state.denied = false;
  state.denyAt = 0;
  state.upstream.mockReset();
  state.gate.mockReset();
  vi.stubEnv("FORUM_COMMERCE_RPC_URL", rpcUrl);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("Unexpected global fetch");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test("normal wallet reads retain exact RPC arguments and pass every actual call through admission", async () => {
  state.upstream.mockImplementation(async (_input, init) => {
    const method = JSON.parse(String(init?.body)).method;
    const result =
      method === "getBalance"
        ? { context: { slot: 42 }, value: 123 }
        : method === "getAccountInfo"
          ? {
              value: {
                owner: TOKEN_2022_PROGRAM,
                data: {
                  parsed: {
                    type: "mint",
                    info: {
                      isInitialized: true,
                      decimals: 6,
                      mintAuthority: null,
                      freezeAuthority: null,
                      extensions: [],
                    },
                  },
                },
              },
            }
          : { context: { slot: 42 }, value: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
  const { ctx, calls } = context();
  const result = await readTerminalWallet(ctx, { wallet });
  expect(result).toMatchObject({
    wallet,
    slot: 42,
    maxSolRaw: null,
    feeReserveLamports: null,
  });
  expect(state.gate.mock.calls.map((call) => call[1])).toEqual([
    "getBalance",
    "getAccountInfo",
    "getTokenAccountsByOwner",
  ]);
  expect(state.upstream).toHaveBeenCalledTimes(3);
  expect(state.upstream.mock.calls.every(([input]) => input === rpcUrl)).toBe(
    true,
  );
  expect(calls.map((call) => call.name)).toEqual([
    "forumTerminalData:claimWalletRead",
    "forumTerminalData:saveWalletRead",
  ]);
});
test("admission denial performs no upstream call and saves no fabricated wallet balance", async () => {
  state.denied = true;
  const { ctx, calls } = context();
  expect(await readTerminalWallet(ctx, { wallet })).toBeNull();
  expect(state.gate).toHaveBeenCalledTimes(1);
  expect(state.upstream).not.toHaveBeenCalled();
  expect(calls.at(-1)?.args.state).toBeNull();
});
test("expiry admission denial is inconclusive, never independent proof of not-landed", async () => {
  state.denied = true;
  const { ctx, calls } = context();
  const fetcher = providerFetch(ctx, {
    rpcUrls: [rpcUrl, "https://api.mainnet-beta.solana.com"],
  });
  await expect(
    inspectProvider(
      rpcUrl,
      { wallet } as Doc<"forumSwapQuotes">,
      "invented",
      fetcher,
    ),
  ).rejects.toBeInstanceOf(ExpiryCheckError);
  expect(state.gate).toHaveBeenCalledTimes(1);
  expect(state.upstream).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});
test.each([true, false])(
  "promotion wallet admission denial=%s cannot reserve inventory or create a payment hold",
  async (denied) => {
    vi.stubEnv("FORUM_PROMOTIONS_ENABLED", "true");
    vi.stubEnv("FORUM_COMMERCE_TREASURY", wallet);
    state.denyAt = denied ? 2 : 0;
    state.upstream.mockImplementation(async (_input, init) => {
      const method = JSON.parse(String(init?.body)).method;
      const result =
        method === "getAccountInfo"
          ? {
              value: {
                owner: TOKEN_2022_PROGRAM,
                data: {
                  parsed: {
                    type: "mint",
                    info: { isInitialized: true, decimals: 6, extensions: [] },
                  },
                },
              },
            }
          : { value: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
    const mutations: string[] = [];
    const ctx = {
      runMutation: vi.fn(async (ref: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(ref);
        mutations.push(name);
        if (name !== "forumCommerce:reserveNetwork")
          throw Error("Unexpected inventory/payment mutation");
        return null;
      }),
    } as unknown as ActionCtx;
    // RegisteredAction omits its test-only runtime hook from the public type.
    const handler = quotePromotion as unknown as {
      _handler(
        ctx: ActionCtx,
        args: { wallet: string; threadId: Id<"forumThreads"> },
      ): Promise<unknown>;
    };
    const request = handler._handler(ctx, {
      wallet,
      threadId: "invented-thread" as Id<"forumThreads">,
    });
    if (denied)
      await expect(request).rejects.toMatchObject({
        code: "provider_admission_denied",
      });
    else
      await expect(request).rejects.toThrow(
        "Fund this wallet with the full promotion amount",
      );
    expect(mutations).toEqual(["forumCommerce:reserveNetwork"]);
    expect(state.gate).toHaveBeenCalledTimes(2);
    expect(state.upstream).toHaveBeenCalledTimes(denied ? 1 : 2);
  },
);
test("relay denial occurs after the one-shot claim and retains the known signature as uncertain", async () => {
  // Existing ephemeral, unfunded local fixture; no wallet/provider is contacted.
  const f = await signedSwapFixture();
  const signed = await inspectSignedSwap(f.signedTransactionBase64, f.prepared);
  for (const [key, value] of Object.entries({
    FORUM_SWAPS_ENABLED: "true",
    FORUM_PLATFORM_FEE_BPS: "50",
    FORUM_SWAP_SIGNATURE_FIRST_ENABLED: "true",
    FORUM_SWAP_AUTORECOVERY_ENABLED: "true",
    FORUM_COMMERCE_TREASURY: f.wallet,
  }))
    vi.stubEnv(key, value);
  state.denied = true;
  const order: string[] = [];
  state.gate.mockImplementation(() => {
    order.push("admission");
  });
  const quoteId = "invented-quote" as Id<"forumSwapQuotes">;
  const row: Doc<"forumSwapQuotes"> = {
    ...f.prepared,
    _id: quoteId,
    treasury: f.wallet,
    _creationTime: Date.now(),
    authUserId: "invented-owner",
    userId: "invented-user" as Id<"users">,
    provider: "jupiter",
    quoteJson: "{}",
    status: "submitted",
    platformFeeBps: 50,
    createdAt: Date.now(),
    expiresAt: Date.now() + 25000,
    signature: signed.signature,
  };
  const mutations: { name: string; args: Record<string, unknown> }[] = [];
  const ctx = {
    runQuery: vi.fn(async () => row),
    runMutation: vi.fn(
      async (
        ref: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>,
      ) => {
        const name = getFunctionName(ref);
        order.push(name);
        mutations.push({ name, args });
        if (name === "forumSwapSubmission:claimRelay") return true;
        if (name === "forumSwapSubmission:saveRelayResult") return null;
        throw Error("Unexpected financial mutation");
      },
    ),
  } as unknown as ActionCtx;
  expect(
    await (
      relay as unknown as {
        _handler(
          ctx: ActionCtx,
          args: {
            quoteId: Id<"forumSwapQuotes">;
            signedTransactionBase64: string;
          },
        ): Promise<unknown>;
      }
    )._handler(ctx, {
      quoteId,
      signedTransactionBase64: f.signedTransactionBase64,
    }),
  ).toEqual({ quoteId, signature: signed.signature });
  expect(order).toEqual([
    "forumSwapSubmission:claimRelay",
    "admission",
    "forumSwapSubmission:saveRelayResult",
  ]);
  expect(mutations.at(-1)?.args).toEqual({ quoteId, accepted: false });
  expect(state.upstream).not.toHaveBeenCalled();
});
