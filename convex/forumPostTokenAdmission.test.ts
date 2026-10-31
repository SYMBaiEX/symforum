import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { verify } from "./forumPostTokens";
import type { ActionCtx } from "./_generated/server";
import { SYMF_TOKEN } from "../lib/symf-token";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test.each([false, true])(
  "post token verification uses shared provider admission; allowed=%s",
  async (allowed) => {
    vi.stubEnv(
      "FORUM_COMMERCE_RPC_URL",
      "https://mainnet.helius-rpc.com/?api-key=isolated-test",
    );
    const fetcher = vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          value: {
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            data: {
              parsed: {
                type: "mint",
                info: { isInitialized: true, decimals: 6 },
              },
            },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const calls: string[] = [];
    let finish: Record<string, unknown> | undefined;
    const runMutation = vi.fn(async (ref, args) => {
      const name = getFunctionName(ref);
      calls.push(name);
      if (name === "forumPostTokens:claim") return true;
      if (name === "forumProviderAdmission:admit") {
        expect(args).toEqual({ provider: "helius", credits: 1 });
        return allowed
          ? { ok: true, reason: null, retryAt: null }
          : { ok: false, reason: "daily", retryAt: Date.now() + 86_400_000 };
      }
      if (name === "forumPostTokens:finish") {
        finish = args;
        return null;
      }
      throw Error("Unexpected operation");
    });
    // Existing internal action with inert claim/finish and real admission wrapper.
    const invoke = (
      verify as unknown as {
        _handler: (
          ctx: ActionCtx,
          args: { mint: string; generation: number },
        ) => Promise<null>;
      }
    )._handler;
    await invoke({ runMutation } as unknown as ActionCtx, {
      mint: SYMF_TOKEN.mint,
      generation: 1,
    });
    expect(calls).toEqual([
      "forumPostTokens:claim",
      "forumProviderAdmission:admit",
      "forumPostTokens:finish",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed)
      expect(finish?.token).toMatchObject({
        mint: SYMF_TOKEN.mint,
        decimals: 6,
      });
    else expect(finish?.token).toBeUndefined();
    expect(finish?.generation).toBe(1);
  },
);
