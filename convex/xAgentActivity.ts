"use node";

import { internal } from "./_generated/api";
import { internalAction, env, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { randomXSecret, sealX, unsealX } from "../lib/x-agent-crypto";
import { officialXAuthor, X_ACTIVITY_SCOPES } from "../lib/x-agent-policy";

class XFailure extends Error {
  constructor(public status: number) {
    super(`X request failed (${status}).`);
  }
}
async function request(path: string, token: string, body?: object) {
  const response = await fetch(`https://api.x.com/2/${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new XFailure(response.status);
  const text = await response.text();
  if (text.length > 256_000) throw Error("Oversized X response.");
  return JSON.parse(text) as Record<string, unknown>;
}
function post(value: unknown) {
  const p = value as Record<string, unknown> | null;
  if (
    !p ||
    typeof p.id !== "string" ||
    !/^\d{1,19}$/.test(p.id) ||
    typeof p.author_id !== "string" ||
    !officialXAuthor(p.author_id) ||
    typeof p.text !== "string" ||
    p.text.length > 25000 ||
    typeof p.created_at !== "string" ||
    !Number.isFinite(Date.parse(p.created_at)) ||
    p.possibly_sensitive === true
  )
    return null;
  const refs = p.referenced_tweets;
  if (
    Array.isArray(refs) &&
    refs.some((r) => r.type === "retweeted" || r.type === "replied_to")
  )
    return null;
  return {
    id: p.id,
    authorId: p.author_id,
    text: p.text,
    createdAt: Date.parse(p.created_at),
  };
}
async function access(
  ctx: ActionCtx,
  activity: Doc<"xAgentActivity">,
  account: Doc<"xAgentAccounts">,
  lease: string,
) {
  if (!env.X_AGENT_TOKEN_KEK || !account.grant)
    throw Error("X grant unavailable.");
  const binding = `${account.ownerUserId}:${account.agentSlug}:grant:v1`;
  const grant = JSON.parse(
    await unsealX(env.X_AGENT_TOKEN_KEK, account.grant, binding),
  ) as { accessToken: string; refreshToken: string };
  if (
    typeof grant.accessToken !== "string" ||
    typeof grant.refreshToken !== "string"
  )
    throw Error("Invalid grant.");
  if ((account.expiresAt ?? 0) > Date.now() + 5 * 60_000)
    return grant.accessToken;
  if (
    !env.X_AGENT_CLIENT_ID ||
    !env.X_AGENT_CLIENT_SECRET ||
    !(await ctx.runMutation(internal.xAgentActivityData.refresh, {
      activityId: activity._id,
      lease,
    }))
  )
    throw Error("Refresh unavailable.");
  // Claim rotating refresh once. Any unknown response leaves the activity held.
  const r = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(env.X_AGENT_CLIENT_ID)}:${encodeURIComponent(env.X_AGENT_CLIENT_SECRET)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
    }).toString(),
  });
  if (!r.ok) throw new XFailure(r.status);
  const raw = await r.text();
  if (raw.length > 16384) throw Error("Invalid refresh response.");
  const t = JSON.parse(raw) as Record<string, unknown>;
  if (
    typeof t.access_token !== "string" ||
    typeof t.refresh_token !== "string" ||
    typeof t.scope !== "string" ||
    !X_ACTIVITY_SCOPES.every((s) =>
      (t.scope as string).split(" ").includes(s),
    ) ||
    String(t.token_type).toLowerCase() !== "bearer" ||
    typeof t.expires_in !== "number" ||
    t.expires_in <= 0 ||
    t.expires_in > 86400
  )
    throw Error("Invalid refreshed grant.");
  const encrypted = await sealX(
    env.X_AGENT_TOKEN_KEK,
    JSON.stringify({
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
    }),
    binding,
  );
  const saved = await ctx.runMutation(internal.xAgentActivityData.refresh, {
    activityId: activity._id,
    lease,
    grant: encrypted,
    scope: t.scope,
    expiresAt: Date.now() + t.expires_in * 1000,
  });
  if (!saved) throw Error("Refresh ownership changed.");
  return t.access_token;
}
async function process(ctx: ActionCtx, activityId: Id<"xAgentActivity">) {
  const lease = randomXSecret();
  const c = await ctx.runMutation(internal.xAgentActivityData.claim, {
    activityId,
    lease,
  });
  if (!c) return;
  const args = { activityId, lease };
  try {
    const token = await access(ctx, c.activity, c.account, lease);
    for (const cursor of c.activity.cursors) {
      if (!officialXAuthor(cursor.userId))
        throw Error("Source is not allowlisted.");
      if (!(await ctx.runMutation(internal.xAgentActivityData.apiRead, args)))
        break;
      const q = new URLSearchParams({
        max_results: "5",
        exclude: "replies,retweets",
        "tweet.fields":
          "author_id,created_at,referenced_tweets,possibly_sensitive",
      });
      if (cursor.sinceId) q.set("since_id", cursor.sinceId);
      else q.set("start_time", new Date(c.activity.enabledAt).toISOString());
      if (cursor.page) q.set("pagination_token", cursor.page);
      const data = await request(`users/${cursor.userId}/tweets?${q}`, token);
      if (data.errors) throw Error("Partial X source response.");
      const posts = Array.isArray(data.data)
        ? data.data
            .map(post)
            .filter((p): p is NonNullable<ReturnType<typeof post>> =>
              Boolean(p && p.authorId === cursor.userId),
            )
        : [];
      const meta = data.meta as
        { newest_id?: string; next_token?: string } | undefined;
      if (meta?.next_token && meta.next_token.length > 4096)
        throw Error("Invalid X page token.");
      await ctx.runMutation(internal.xAgentActivityData.ingest, {
        ...args,
        userId: cursor.userId,
        posts,
        newestId: cursor.newestId ?? meta?.newest_id,
        nextPage: meta?.next_token,
      });
    }
    const op = await ctx.runMutation(internal.xAgentActivityData.next, args);
    if (
      op &&
      (await ctx.runMutation(internal.xAgentActivityData.apiRead, args))
    ) {
      // Recheck the actual author and text before a send. Edits/deletions stop it.
      const check = await request(
        `tweets/${op.post.id}?tweet.fields=author_id,created_at,referenced_tweets,possibly_sensitive`,
        token,
      );
      const current = post(check.data);
      if (
        !current ||
        check.errors ||
        current.authorId !== op.post.authorId ||
        current.text !== op.post.text
      ) {
        throw Error(
          "Official source changed or is no longer available. Review before resuming.",
        );
      }
      const send = await ctx.runMutation(
        internal.xAgentActivityData.claimSend,
        { ...args, operationId: op._id },
      );
      if (send) {
        try {
          const result =
            op.kind === "repost"
              ? await request(`users/${c.account.xUserId}/retweets`, token, {
                  tweet_id: op.post.id,
                })
              : await request("tweets", token, {
                  text: send.text,
                  reply: { in_reply_to_tweet_id: op.post.id },
                });
          const data = result.data as
            { retweeted?: boolean; id?: string; text?: string } | undefined;
          const confirmed =
            !result.errors &&
            (op.kind === "repost"
              ? data?.retweeted === true
              : Boolean(data?.id && /^\d{1,19}$/.test(data.id)));
          await ctx.runMutation(internal.xAgentActivityData.finishSend, {
            ...args,
            operationId: op._id,
            confirmed,
            resultId:
              op.kind === "repost"
                ? confirmed
                  ? op.post.id
                  : undefined
                : data?.id,
            issue: confirmed
              ? undefined
              : "X did not confirm delivery. Held without replay.",
          });
          if (!confirmed) throw Error("X did not confirm delivery.");
        } catch (e) {
          await ctx.runMutation(internal.xAgentActivityData.finishSend, {
            ...args,
            operationId: op._id,
            confirmed: false,
            issue:
              "Send failed or its outcome is unknown. Reconcile; never automatically replay.",
          });
          throw e;
        }
      }
    }
    await ctx.runMutation(internal.xAgentActivityData.release, {
      ...args,
      poll: true,
    });
  } catch (e) {
    // Provider errors are never routed through another app or browser.
    const rate = e instanceof XFailure && e.status === 429;
    await ctx.runMutation(internal.xAgentActivityData.release, {
      ...args,
      poll: true,
      issue: rate
        ? "X rate limit reached. Paused; review the provider limit before resuming."
        : "X access, source validation or delivery needs review. Paused without replaying uncertain work.",
      delayMs: rate ? 60 * 60_000 : undefined,
    });
  }
}
export const tick = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.runQuery(internal.xAgentActivityData.due, {
      now: Date.now(),
    });
    for (const id of due) await process(ctx, id);
    return null;
  },
});
