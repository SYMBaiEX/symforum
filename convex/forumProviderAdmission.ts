import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import type { ProviderAdmission } from "./forumProviderFetch";

const DAY = 86_400_000;
const CREDIT_SLOTS = FORUM_READ_POLICY.helius.rollingDays + 1;
const limiter = new RateLimiter(components.rateLimiter, {});
type WindowConfig = {
  kind: "fixed window";
  rate: number;
  capacity: number;
  period: number;
  start: number;
};
const positiveModulo = (n: number, modulo: number) =>
  ((n % modulo) + modulo) % modulo;

function windowConfig(
  rate: number,
  width: number,
  slots: number,
  slot: number,
): WindowConfig {
  return {
    kind: "fixed window",
    rate,
    capacity: rate,
    period: width * slots,
    start: slot * width,
  };
}

/**
 * The component stores the unrefilled value and its last aligned window start.
 * A rotating slot is unused in this cycle iff its stored start is older than
 * the requested cycle. It is never reset or refunded by this application.
 */
async function used(
  ctx: MutationCtx,
  name: string,
  key: string,
  config: WindowConfig,
  expectedStart: number,
): Promise<number> {
  const value = await limiter.getValue(ctx, name, { key, config });
  if (
    !Number.isSafeInteger(value.ts) ||
    value.ts > expectedStart ||
    !Number.isSafeInteger(value.value) ||
    value.value < 0 ||
    value.value > config.capacity
  )
    throw new Error("Provider allowance state is invalid.");
  return value.ts === expectedStart ? config.capacity - value.value : 0;
}

const provider = v.union(
  v.literal("helius"),
  v.literal("dexscreener"),
  v.literal("geckoterminal"),
);
const result = v.union(
  v.object({ ok: v.literal(true), reason: v.null(), retryAt: v.null() }),
  v.object({
    ok: v.literal(false),
    reason: v.union(
      v.literal("burst"),
      v.literal("daily"),
      v.literal("rolling"),
    ),
    retryAt: v.number(),
  }),
);

/**
 * Shared pre-I/O admission. Only the rate-limiter component owns counters.
 * Two adjacent fixed buckets conservatively cover a rolling request window;
 * 33 UTC day buckets cover every rolling 32-day credit window. Rotating slots
 * keep storage bounded to eight request rows plus 33 credit rows. This may defer
 * earlier than a precise sliding log, never later than the published ceiling.
 * All component reads/consumption share this parent mutation transaction.
 */
export const admit = internalMutation({
  args: {
    provider,
    credits: v.number(),
    sendTransaction: v.optional(v.literal(true)),
  },
  returns: result,
  handler: async (ctx, args): Promise<ProviderAdmission> => {
    const now = Date.now();
    if (
      !Number.isSafeInteger(now) ||
      now <= 0 ||
      !Number.isSafeInteger(args.credits) ||
      args.credits < 1 ||
      args.credits > FORUM_READ_POLICY.helius.dailyCredits ||
      (args.provider !== "helius" && args.credits !== 1) ||
      (args.sendTransaction &&
        (args.provider !== "helius" || args.credits !== 1))
    )
      throw new Error("Invalid provider admission.");
    const policy = FORUM_READ_POLICY[args.provider];
    const width = policy.windowMs;
    const bucket = Math.floor(now / width);
    const slot = positiveModulo(bucket, 2);
    const name = "forumProviderBurstV1";
    const key = `${args.provider}:${slot}`;
    const config = windowConfig(policy.requestsPerWindow, width, 2, slot);
    const current = await used(ctx, name, key, config, bucket * width);
    const previousSlot = positiveModulo(bucket - 1, 2);
    const previous = await used(
      ctx,
      name,
      `${args.provider}:${previousSlot}`,
      windowConfig(policy.requestsPerWindow, width, 2, previousSlot),
      (bucket - 1) * width,
    );
    let denied: Extract<ProviderAdmission, { ok: false }> | null =
      current + previous + 1 > policy.requestsPerWindow
        ? {
            ok: false,
            reason: "burst",
            retryAt:
              (bucket + (current + 1 <= policy.requestsPerWindow ? 1 : 2)) *
              width,
          }
        : null;
    let creditArgs: {
      key: string;
      config: WindowConfig;
      count: number;
    } | null = null;
    let sendArgs: { key: string; config: WindowConfig; count: number } | null =
      null;
    if (args.sendTransaction) {
      const sendPolicy = FORUM_READ_POLICY.helius;
      const sendBucket = Math.floor(now / sendPolicy.sendWindowMs);
      const sendSlot = positiveModulo(sendBucket, 2);
      const sendConfig = windowConfig(
        sendPolicy.sendRequestsPerWindow,
        sendPolicy.sendWindowMs,
        2,
        sendSlot,
      );
      const sendKey = `helius-send:${sendSlot}`;
      const sendCurrent = await used(
        ctx,
        name,
        sendKey,
        sendConfig,
        sendBucket * sendPolicy.sendWindowMs,
      );
      const sendPreviousSlot = positiveModulo(sendBucket - 1, 2);
      const sendPrevious = await used(
        ctx,
        name,
        `helius-send:${sendPreviousSlot}`,
        windowConfig(
          sendPolicy.sendRequestsPerWindow,
          sendPolicy.sendWindowMs,
          2,
          sendPreviousSlot,
        ),
        (sendBucket - 1) * sendPolicy.sendWindowMs,
      );
      if (sendCurrent + sendPrevious + 1 > sendPolicy.sendRequestsPerWindow) {
        const retryAt =
          (sendBucket +
            (sendCurrent + 1 <= sendPolicy.sendRequestsPerWindow ? 1 : 2)) *
          sendPolicy.sendWindowMs;
        if (retryAt > (denied?.retryAt ?? 0))
          denied = { ok: false, reason: "burst", retryAt };
      }
      sendArgs = { key: sendKey, config: sendConfig, count: 1 };
    }
    if (args.provider === "helius") {
      const day = Math.floor(now / DAY);
      const credits = [];
      for (let offset = 0; offset < CREDIT_SLOTS; offset++) {
        const date = day - offset;
        const creditSlot = positiveModulo(date, CREDIT_SLOTS);
        const creditKey = `helius:${creditSlot}`;
        const creditConfig = windowConfig(
          FORUM_READ_POLICY.helius.dailyCredits,
          DAY,
          CREDIT_SLOTS,
          creditSlot,
        );
        credits.push({
          day: date,
          used: await used(
            ctx,
            "forumProviderCreditsV1",
            creditKey,
            creditConfig,
            date * DAY,
          ),
        });
        if (offset === 0)
          creditArgs = {
            key: creditKey,
            config: creditConfig,
            count: args.credits,
          };
      }
      const today = credits[0]!.used;
      let total = credits.reduce((sum, credit) => sum + credit.used, 0);
      const dailyRetryAt =
        today + args.credits > FORUM_READ_POLICY.helius.dailyCredits
          ? (day + 1) * DAY
          : 0;
      let rollingRetryAt = 0;
      if (total + args.credits > FORUM_READ_POLICY.helius.rollingCredits) {
        // At each following midnight the oldest conservatively covered day
        // leaves the 33-bucket set. No future use or quota refund is assumed.
        for (const credit of [...credits].reverse()) {
          total -= credit.used;
          rollingRetryAt = (credit.day + CREDIT_SLOTS) * DAY;
          if (total + args.credits <= FORUM_READ_POLICY.helius.rollingCredits)
            break;
        }
      }
      if (dailyRetryAt > (denied?.retryAt ?? 0))
        denied = { ok: false, reason: "daily", retryAt: dailyRetryAt };
      if (rollingRetryAt > (denied?.retryAt ?? 0))
        denied = { ok: false, reason: "rolling", retryAt: rollingRetryAt };
    }
    if (denied) return denied;
    const burst = await limiter.limit(ctx, name, { key, config, count: 1 });
    if (!burst.ok) throw new Error("Provider allowance changed unexpectedly.");
    if (sendArgs) {
      const send = await limiter.limit(ctx, name, sendArgs);
      if (!send.ok)
        throw new Error("Provider method allowance changed unexpectedly.");
    }
    if (creditArgs) {
      const credit = await limiter.limit(
        ctx,
        "forumProviderCreditsV1",
        creditArgs,
      );
      if (!credit.ok)
        throw new Error("Provider credit allowance changed unexpectedly.");
    }
    return { ok: true, reason: null, retryAt: null };
  },
});
