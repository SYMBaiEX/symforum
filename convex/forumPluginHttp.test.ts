/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { ConvexError } from "convex/values";
import { forumPluginHttpError } from "./forumPluginHttp";
const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
async function fixture(review = false) {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", {
      username: "upload-owner",
      usernameNormalized: "upload-owner",
      forumTrustedAt: 1,
      email: "upload@example.test",
      emailVerificationTime: 1,
    }),
  );
  const owner = t.withIdentity({ subject: ownerId });
  const { connectionId } = await owner.mutation(
    api.forumPluginAccess.createBrowserConnection,
    {
      actorMode: "agent",
      executionMode: review ? "review" : "direct",
      capabilities: ["read", "attachments"],
    },
  );
  await t.run(async (ctx) => {
    const connection = await ctx.db.get("forumPluginConnections", connectionId);
    const credential = await ctx.db.get(
      "agentIdentities",
      connection!.credentialAgentIdentityId,
    );
    const now = Date.now();
    const monthKey = new Date(now).toISOString().slice(0, 7);
    await ctx.db.insert("agentQuotaBudgets", {
      ownerUserId: ownerId,
      monthKey,
      freeAllowanceUnits: 100,
      hardCapUnits: 1000,
      usedUnits: 1000,
      hardCapMetadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentQuotaUsageCounters", {
      ownerUserId: ownerId,
      agentId: credential!.agentId,
      monthKey,
      usedUnits: 250,
      updatedAt: now,
    });
  });
  return { t, owner, connectionId };
}
function uploadHeaders(connectionId: string, key = "http-upload-one") {
  return {
    Origin: "https://forum.symbaiex.com",
    "Content-Type": "text/plain",
    "X-Forum-Attachment-Filename": "sample.txt",
    "X-Forum-Plugin-Connection": connectionId,
    "X-Forum-Plugin-Policy-Version": "1",
    "Idempotency-Key": key,
  };
}
describe("forum plugin HTTP boundaries", () => {
  test("public discovery succeeds while malformed/authenticated cross-resource calls fail", async () => {
    const { t } = await fixture();
    const request = (body: unknown, extra: Record<string, string> = {}) => ({
      method: "POST",
      headers: { "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
    const publicRead = await t.fetch(
      "/plugin/forum",
      request({ operation: "overview", args: {} }),
    );
    expect(publicRead.status).toBe(200);
    expect((await publicRead.json()).actingAs).toBeNull();
    expect(
      (
        await t.fetch(
          "/plugin/forum",
          request({ operation: "status", args: {} }),
        )
      ).status,
    ).toBe(401);
    const token = `e30.${btoa(JSON.stringify({ aud: "https://www.symbaiex.com/api/agent/mcp" }))}.fake`;
    expect(
      (
        await t.fetch(
          "/plugin/forum",
          request(
            { operation: "overview", args: {} },
            { Authorization: `Bearer ${token}` },
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await t.fetch(
          "/plugin/forum",
          request({ operation: "overview", args: { unexpected: true } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await t.fetch(
          "/plugin/forum",
          request(
            { operation: "overview", args: {} },
            { Origin: "https://attacker.test" },
          ),
        )
      ).status,
    ).toBe(403);
  });
  test("browser uploads ignore exhausted evidence budgets, belong to selected actor and deduplicate bytes", async () => {
    const { t, owner, connectionId } = await fixture();
    const request = {
      method: "POST",
      headers: uploadHeaders(connectionId),
      body: "sample text",
    };
    const first = await owner.fetch("/plugin/forum/attachments", request);
    expect(first.status).toBe(200);
    const receipt = await first.json();
    expect(receipt.status).toBe("completed");
    expect(receipt).not.toHaveProperty("retainedStorageId");
    expect(
      await (await owner.fetch("/plugin/forum/attachments", request)).json(),
    ).toEqual(receipt);
    await t.run(async (ctx) => {
      const records = await ctx.db.query("forumPendingUploads").collect();
      expect(records).toHaveLength(1);
      expect(String(records[0].userId)).toBe(receipt.actingAs.userId);
      expect(await ctx.db.system.query("_storage").collect()).toHaveLength(1);
    });
    expect(
      (
        await owner.fetch("/plugin/forum/attachments", {
          ...request,
          body: "changed content",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner.fetch("/plugin/forum/attachments", {
          ...request,
          headers: { ...request.headers, "X-Forum-Plugin-Policy-Version": "0" },
        })
      ).status,
    ).toBe(409);
  });
  test("review uploads ignore exhausted evidence budgets and publish only after human approval", async () => {
    const { t, owner, connectionId } = await fixture(true);
    const request = {
      method: "POST",
      headers: uploadHeaders(connectionId),
      body: "review text",
    };
    const first = await owner.fetch("/plugin/forum/attachments", request);
    expect(first.status).toBe(200);
    const receipt = await first.json();
    expect(receipt.status).toBe("pending_approval");
    expect(receipt).not.toHaveProperty("retainedStorageId");
    await owner.fetch("/plugin/forum/attachments", request);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumPendingUploads").collect()).toHaveLength(
        0,
      );
      expect(await ctx.db.system.query("_storage").collect()).toHaveLength(1);
    });
    const approved = await owner.mutation(api.forumPlugin.approveCommand, {
      commandId: receipt.commandId,
    });
    expect(approved.status).toBe("completed");
    expect(
      (await (await owner.fetch("/plugin/forum/attachments", request)).json())
        .data.storageId,
    ).toBe((approved.data as { storageId: string }).storageId);
    await t.run(async (ctx) => {
      expect(await ctx.db.system.query("_storage").collect()).toHaveLength(1);
    });
  });
  test("rejects bytes outside limits before storage or quota is committed", async () => {
    const { t, owner, connectionId } = await fixture();
    const headers = uploadHeaders(connectionId);
    expect(
      (
        await t.fetch("/plugin/forum/attachments", {
          method: "POST",
          headers,
          body: "guest",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await owner.fetch("/plugin/forum/attachments", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/javascript" },
          body: "script",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await owner.fetch("/plugin/forum/attachments", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": String(5 * 1024 * 1024 + 1),
          },
          body: "large",
        })
      ).status,
    ).toBe(413);
    await t.run(async (ctx) => {
      expect(await ctx.db.system.query("_storage").collect()).toHaveLength(0);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
});

test("quota HTTP diagnostics preserve allowlisted reason, millisecond delay and bounded safe fields", async () => {
  const request = new Request("https://forum.symbaiex.com/plugin/forum");
  const resetsAt = Date.UTC(2027, 0, 1);
  const response = forumPluginHttpError(
    request,
    new ConvexError({
      code: "AGENT_QUOTA_EXCEEDED",
      message: "Read rate limit reached.",
      reason: "rate-limited",
      retryAfter: 1501,
      resetsAt,
      token: "secret",
      quota: {
        agentUsedUnits: 250,
        agentLimitUnits: 250,
        ownerUsedUnits: 250,
        ownerLimitUnits: 1000,
        remainingUnits: 0,
        resetsAt,
        settingsUrl: "https://www.symbaiex.com/developer",
        hardCapMetadataJson: "secret",
        otherCredential: "secret",
      },
    }),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(await response.json()).toEqual({
    code: "AGENT_QUOTA_EXCEEDED",
    error: "Read rate limit reached.",
    quotaReason: "rate-limited",
    retryAfter: 1501,
    resetsAt,
    quota: {
      agentUsedUnits: 250,
      agentLimitUnits: 250,
      ownerUsedUnits: 250,
      ownerLimitUnits: 1000,
      remainingUnits: 0,
      resetsAt,
      settingsUrl: "https://www.symbaiex.com/developer",
    },
  });
});

test("quota mapper omits unknown reasons, invalid retry delays, unsafe quota values and unknown secrets", async () => {
  for (const retryAfter of [-1, Infinity, NaN, 86_400_001]) {
    const response = forumPluginHttpError(
      new Request("https://forum.symbaiex.com/plugin/forum"),
      new ConvexError({
        code: "AGENT_QUOTA_EXCEEDED",
        message: "Quota reached.",
        quotaReason: "secret",
        retryAfter,
        resetsAt: -1,
        quota: {
          agentUsedUnits: -1,
          agentLimitUnits: 1_000_000_001,
          ownerUsedUnits: 1.5,
          ownerLimitUnits: Infinity,
          remainingUnits: "secret",
          resetsAt: "secret",
          settingsUrl: "https://attacker.test/secret",
          token: "secret",
        },
      }),
    );
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await response.json()).toEqual({
      code: "AGENT_QUOTA_EXCEEDED",
      error: "Quota reached.",
    });
  }
  const unknown = forumPluginHttpError(
    new Request("https://forum.symbaiex.com/plugin/forum"),
    new ConvexError({
      code: "UNKNOWN_FAILURE",
      message: "Failed.",
      reason: "secret",
      retryAfter: 1000,
      quota: { agentUsedUnits: 5 },
      token: "secret",
    }),
  );
  expect(await unknown.json()).toEqual({
    code: "UNKNOWN_FAILURE",
    error: "Failed.",
  });
});

test("forum admission errors expose only temporary retry diagnostics", async () => {
  const response = forumPluginHttpError(
    new Request("https://forum.symbaiex.com/plugin/forum"),
    new ConvexError({
      code: "FORUM_RATE_LIMITED",
      message: "Forum write rate limit reached.",
      quotaReason: "rate-limited",
      retryAfter: 1501,
      token: "secret",
    }),
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(await response.json()).toEqual({
    code: "FORUM_RATE_LIMITED",
    error: "Forum write rate limit reached.",
    quotaReason: "rate-limited",
    retryAfter: 1501,
  });
});
