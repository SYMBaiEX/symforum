import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import type { TerminalWalletReadState } from "../lib/forum-terminal-model";
import {
  parseTerminalMint,
  NATIVE_SOL_MINT,
  TERMINAL_WALLET_TTL_MS,
  TERMINAL_RISK_TTL_MS,
  sumTerminalTokenAccounts,
  type TerminalRisk,
} from "../lib/forum-terminal-data";
import { commerceConfig, record, unsignedRaw } from "../lib/forum-commerce";
import { commerceRpc } from "./forumCommerceRpc";
import { SYMF_TOKEN } from "../lib/symf-token";
import { providerFetch } from "./forumProviderFetch";

/** Read-only RPC; never receives a signer, transaction, private key or send method. */
export async function readTerminalWallet(
  ctx: ActionCtx,
  args: { wallet: string; selectedMint?: string },
): Promise<TerminalWalletReadState | null> {
  const config = commerceConfig(env);
  if (!config.rpcUrl) throw new ConvexError("Wallet data is unavailable.");
  const lease = crypto.randomUUID();
  const claim = await ctx.runMutation(
    internal.forumTerminalData.claimWalletRead,
    { ...args, lease },
  );
  if (!claim.fetch)
    return claim.state && claim.state.expiresAt > Date.now()
      ? claim.state
      : null;
  try {
    const fetcher = providerFetch(ctx, { rpcUrls: [config.rpcUrl] });
    const balance = record(
      await commerceRpc(
        config.rpcUrl,
        "getBalance",
        [args.wallet, { commitment: "finalized" }],
        fetcher,
      ),
    );
    if (!Number.isSafeInteger(balance.value) || Number(balance.value) < 0)
      throw new Error("Unverified SOL balance.");
    const slot = record(balance.context).slot;
    if (!Number.isSafeInteger(slot) || Number(slot) < 0)
      throw new Error("Unverified slot.");
    const balances = [
      { mint: NATIVE_SOL_MINT, rawAmount: String(balance.value), decimals: 9 },
    ];
    unsignedRaw(String(balance.value));
    for (const mint of new Set(
      [SYMF_TOKEN.mint, args.selectedMint ?? SYMF_TOKEN.mint].filter(
        (m) => m && m !== NATIVE_SOL_MINT,
      ),
    )) {
      const result = record(
        await commerceRpc(
          config.rpcUrl,
          "getAccountInfo",
          [
            mint,
            {
              encoding: "jsonParsed",
              commitment: "finalized",
              minContextSlot: Number(slot),
            },
          ],
          fetcher,
        ),
      );
      const info = parseTerminalMint(result.value, mint, Date.now());
      const accounts = await commerceRpc(
        config.rpcUrl,
        "getTokenAccountsByOwner",
        [
          args.wallet,
          { mint },
          {
            encoding: "jsonParsed",
            commitment: "finalized",
            minContextSlot: Number(slot),
          },
        ],
        fetcher,
      );
      const accountSlot = record(record(accounts).context).slot;
      if (
        !Number.isSafeInteger(accountSlot) ||
        Number(accountSlot) < Number(slot)
      )
        throw new Error("Token balance context is stale.");
      balances.push({
        mint,
        decimals: info.decimals,
        rawAmount: sumTerminalTokenAccounts(
          accounts,
          args.wallet,
          mint,
          info.decimals,
          info.risk.tokenProgram,
        ),
      });
    }
    const checkedAt = Date.now();
    const state: TerminalWalletReadState = {
      wallet: args.wallet,
      checkedAt,
      expiresAt: checkedAt + TERMINAL_WALLET_TTL_MS,
      slot: Number(slot),
      balances,
      // No exact route/message exists at this stage. Guessing a SOL reserve
      // could leave insufficient rent/priority fees; preparation owns Max.
      maxSolRaw: null,
      feeReserveLamports: null,
    };
    await ctx.runMutation(internal.forumTerminalData.saveWalletRead, {
      wallet: args.wallet,
      lease,
      state,
    });
    return state;
  } catch {
    await ctx.runMutation(internal.forumTerminalData.saveWalletRead, {
      wallet: args.wallet,
      lease,
      state: null,
    });
    return null;
  }
}

export async function readTerminalRisk(
  ctx: ActionCtx,
  args: { wallet: string; mint: string },
): Promise<TerminalRisk | null> {
  const config = commerceConfig(env);
  if (!config.rpcUrl)
    throw new ConvexError("Token authority data is unavailable.");
  const lease = crypto.randomUUID();
  const claim = await ctx.runMutation(
    internal.forumTerminalData.claimRiskRead,
    { ...args, lease },
  );
  if (!claim.fetch)
    return claim.risk &&
      Date.now() - claim.risk.checkedAt <= TERMINAL_RISK_TTL_MS
      ? claim.risk
      : null;
  try {
    const fetcher = providerFetch(ctx, { rpcUrls: [config.rpcUrl] });
    const result = record(
      await commerceRpc(
        config.rpcUrl,
        "getAccountInfo",
        [args.mint, { encoding: "jsonParsed", commitment: "finalized" }],
        fetcher,
      ),
    );
    const risk = parseTerminalMint(result.value, args.mint, Date.now()).risk;
    await ctx.runMutation(internal.forumTerminalData.saveRiskRead, {
      mint: args.mint,
      lease,
      risk,
    });
    return risk;
  } catch {
    await ctx.runMutation(internal.forumTerminalData.saveRiskRead, {
      mint: args.mint,
      lease,
      risk: null,
    });
    return null;
  }
}
