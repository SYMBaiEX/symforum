/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const refund = makeFunctionReference<"mutation">("forumReadQuotaRefund:refund");
async function fixture(readCount = 250) {
  const t = convexTest(schema, modules);
  const seed = await t.run(async (ctx) => {
    const now = Date.now(),
      monthKey = new Date(now).toISOString().slice(0, 7);
    const ownerUserId = await ctx.db.insert("users", {
      username: "refund-owner",
      usernameNormalized: "refund-owner",
    });
    const stranger = await ctx.db.insert("users", {
      username: "refund-stranger",
      usernameNormalized: "refund-stranger",
    });
    const agentUserId = await ctx.db.insert("users", {
      username: "refund-agent",
      usernameNormalized: "refund-agent",
      isAgent: true,
      agentSlug: "refund-agent",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
    });
    const agentId = "refund-agent";
    const credentialAgentIdentityId = await ctx.db.insert("agentIdentities", {
      agentId,
      userId: agentUserId,
      ownerUserId,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const connection = {
      ownerUserId,
      credentialAgentIdentityId,
      actorUserId: ownerUserId,
      actorMode: "human" as const,
      transport: "oauth" as const,
      kind: "forum-plugin" as const,
      resource: "https://www.symbaiex.com/api/plugin/mcp" as const,
      issuer: "https://test.authkit.app",
      subject: ownerUserId,
      keyVersion: 1,
      capabilities: ["read" as const],
      capabilityCeiling: ["read" as const],
      executionMode: "direct" as const,
      policyVersion: 1,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };
    const connectionId = await ctx.db.insert(
      "forumPluginConnections",
      connection,
    );
    const otherConnection = await ctx.db.insert(
      "forumPluginConnections",
      connection,
    );
    const insert = async (
      operation: string,
      metadataJson: string,
      key: string,
    ) =>
      ctx.db.insert("agentQuotaUsage", {
        ownerUserId,
        agentId,
        monthKey,
        idempotencyKey: key,
        operation,
        units: 1,
        createdAt: now,
        metadataJson,
      });
    for (let n = 0; n < readCount; n++)
      await insert(
        "forum.read.listChatMessages",
        JSON.stringify({ connectionId, actorUserId: ownerUserId }),
        `read-${n}`,
      );
    await insert(
      "forum.write.createThread",
      JSON.stringify({ connectionId }),
      "write-one",
    );
    await insert(
      "evidence.search",
      JSON.stringify({ connectionId }),
      "evidence-one",
    );
    await insert(
      "forum.read.listCategories",
      JSON.stringify({ connectionId: otherConnection }),
      "other-connection",
    );
    await insert("forum.read.overview", "malformed-json", "malformed");
    const used = readCount + 4;
    const budgetId = await ctx.db.insert("agentQuotaBudgets", {
      ownerUserId,
      monthKey,
      freeAllowanceUnits: 100,
      hardCapUnits: used,
      usedUnits: used,
      hardCapReachedAt: now,
      hardCapMetadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    const counterId = await ctx.db.insert("agentQuotaUsageCounters", {
      ownerUserId,
      agentId,
      monthKey,
      usedUnits: used,
      updatedAt: now,
    });
    return {
      connectionId,
      ownerUserId,
      agentId,
      monthKey,
      budgetId,
      counterId,
      stranger,
      used,
    };
  });
  const args = {
    connectionId: seed.connectionId,
    ownerUserId: seed.ownerUserId,
    agentId: seed.agentId,
    monthKey: seed.monthKey,
  };
  return { t, seed, args };
}

test("250-read correction defaults to preview, preserves other usage and refunds exactly once with durable receipt", async () => {
  const { t, seed, args } = await fixture();
  const before = await t.run((ctx) =>
    ctx.db.query("agentQuotaUsage").collect(),
  );
  const dry = await t.mutation(refund, args);
  expect(dry).toMatchObject({
    dryRun: true,
    alreadyApplied: false,
    preview: {
      scannedCount: 254,
      sourceCount: 250,
      refundedUnits: 250,
      ownerUsedBefore: 254,
      agentUsedBefore: 254,
      canApply: true,
    },
  });
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.get("agentQuotaBudgets", seed.budgetId))?.usedUnits,
    ).toBe(254);
    expect(await ctx.db.query("forumReadQuotaRefunds").collect()).toHaveLength(
      0,
    );
  });
  const applied = await t.mutation(refund, {
    ...args,
    dryRun: false,
    expectedFingerprint: dry.preview.fingerprint,
  });
  expect(applied.receipt).toMatchObject({
    sourceCount: 250,
    refundedUnits: 250,
    ownerUsedBefore: 254,
    ownerUsedAfter: 4,
    agentUsedBefore: 254,
    agentUsedAfter: 4,
    fingerprint: dry.preview.fingerprint,
  });
  const retry = await t.mutation(refund, {
    ...args,
    dryRun: false,
    expectedFingerprint: dry.preview.fingerprint,
  });
  expect(retry.alreadyApplied).toBe(true);
  expect(retry.receipt).toEqual(applied.receipt);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("agentQuotaUsage").collect()).toEqual(before);
    const budget = await ctx.db.get("agentQuotaBudgets", seed.budgetId);
    expect(budget?.usedUnits).toBe(4);
    expect(budget?.hardCapReachedAt).toBeUndefined();
    expect(
      (await ctx.db.get("agentQuotaUsageCounters", seed.counterId))?.usedUnits,
    ).toBe(4);
    expect(await ctx.db.query("forumReadQuotaRefunds").collect()).toHaveLength(
      1,
    );
  });
});

test("refund binding rejects other owner/credential/month and requires an unchanged preview", async () => {
  const { t, seed, args } = await fixture(2);
  for (const forged of [
    { ...args, ownerUserId: seed.stranger },
    { ...args, agentId: "other-agent" },
    { ...args, monthKey: "2000-01" },
  ])
    await expect(t.mutation(refund, forged)).rejects.toThrow();
  await expect(t.mutation(refund, { ...args, dryRun: false })).rejects.toThrow(
    "preview is missing",
  );
  const preview = await t.mutation(refund, args);
  await t.run((ctx) =>
    ctx.db.insert("agentQuotaUsage", {
      ownerUserId: seed.ownerUserId,
      agentId: seed.agentId,
      monthKey: seed.monthKey,
      idempotencyKey: "later-read",
      operation: "forum.read.overview",
      units: 1,
      createdAt: Date.now(),
      metadataJson: JSON.stringify({ connectionId: seed.connectionId }),
    }),
  );
  await expect(
    t.mutation(refund, {
      ...args,
      dryRun: false,
      expectedFingerprint: preview.preview.fingerprint,
    }),
  ).rejects.toThrow("sources changed");
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.get("agentQuotaBudgets", seed.budgetId))?.usedUnits,
    ).toBe(seed.used);
    expect(
      (await ctx.db.get("agentQuotaUsageCounters", seed.counterId))?.usedUnits,
    ).toBe(seed.used);
    expect(await ctx.db.query("forumReadQuotaRefunds").collect()).toHaveLength(
      0,
    );
  });
});

test.each(["owner", "credential"] as const)(
  "insufficient %s counter prevents any subtraction or receipt",
  async (which) => {
    const { t, seed, args } = await fixture(2);
    await t.run(async (ctx) => {
      if (which === "owner")
        await ctx.db.patch("agentQuotaBudgets", seed.budgetId, {
          usedUnits: 1,
        });
      else
        await ctx.db.patch("agentQuotaUsageCounters", seed.counterId, {
          usedUnits: 1,
        });
    });
    const preview = await t.mutation(refund, args);
    expect(preview.preview.canApply).toBe(false);
    await expect(
      t.mutation(refund, {
        ...args,
        dryRun: false,
        expectedFingerprint: preview.preview.fingerprint,
      }),
    ).rejects.toThrow("sufficient owner");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("agentQuotaBudgets", seed.budgetId))?.usedUnits,
      ).toBe(which === "owner" ? 1 : seed.used);
      expect(
        (await ctx.db.get("agentQuotaUsageCounters", seed.counterId))
          ?.usedUnits,
      ).toBe(which === "credential" ? 1 : seed.used);
      expect(
        await ctx.db.query("forumReadQuotaRefunds").collect(),
      ).toHaveLength(0);
    });
  },
);

test("301-row scan fails closed rather than partially refunding", async () => {
  const { t, seed, args } = await fixture(297);
  await expect(t.mutation(refund, args)).rejects.toThrow("scan exceeds 300");
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.get("agentQuotaBudgets", seed.budgetId))?.usedUnits,
    ).toBe(seed.used);
    expect(
      (await ctx.db.get("agentQuotaUsageCounters", seed.counterId))?.usedUnits,
    ).toBe(seed.used);
    expect(await ctx.db.query("forumReadQuotaRefunds").collect()).toHaveLength(
      0,
    );
  });
});

test("refund preserves hard-cap reached flag when remaining unrelated usage still meets cap", async () => {
  const { t, seed, args } = await fixture(2);
  await t.run((ctx) =>
    ctx.db.patch("agentQuotaBudgets", seed.budgetId, { hardCapUnits: 4 }),
  );
  const preview = await t.mutation(refund, args);
  await t.mutation(refund, {
    ...args,
    dryRun: false,
    expectedFingerprint: preview.preview.fingerprint,
  });
  await t.run(async (ctx) => {
    const budget = await ctx.db.get("agentQuotaBudgets", seed.budgetId);
    expect(budget?.usedUnits).toBe(4);
    expect(budget?.hardCapReachedAt).toBeDefined();
  });
});

test("concurrent identical correction attempts share one receipt and one counter reduction", async () => {
  const { t, seed, args } = await fixture(2);
  const preview = await t.mutation(refund, args);
  const apply = {
    ...args,
    dryRun: false,
    expectedFingerprint: preview.preview.fingerprint,
  };
  const [first, second] = await Promise.all([
    t.mutation(refund, apply),
    t.mutation(refund, apply),
  ]);
  expect(first.receipt).toEqual(second.receipt);
  await t.run(async (ctx) => {
    expect(
      (await ctx.db.get("agentQuotaBudgets", seed.budgetId))?.usedUnits,
    ).toBe(4);
    expect(
      (await ctx.db.get("agentQuotaUsageCounters", seed.counterId))?.usedUnits,
    ).toBe(4);
    expect(await ctx.db.query("forumReadQuotaRefunds").collect()).toHaveLength(
      1,
    );
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(6);
  });
});
