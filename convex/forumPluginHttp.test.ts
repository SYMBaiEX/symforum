/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
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
  test("browser uploads belong to selected actor and duplicate bytes leave one blob", async () => {
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
  test("review uploads retain one staged blob and publish only after human approval", async () => {
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
