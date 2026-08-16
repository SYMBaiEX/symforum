/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const commerce = {
  seedDefaultProducts: makeFunctionReference<
    "mutation",
    Record<string, never>,
    any
  >("apiCommerce:seedDefaultProducts"),
  beginOrReplayCommand: makeFunctionReference<"mutation", any, any>(
    "apiCommerce:beginOrReplayCommand",
  ),
  getMyEntitlements: makeFunctionReference<"query", Record<string, never>, any>(
    "apiCommerce:getMyEntitlements",
  ),
  getMyAccessSummary: makeFunctionReference<
    "query",
    Record<string, never>,
    any
  >("apiCommerce:getMyAccessSummary"),
  getMyUsageStatus: makeFunctionReference<"query", { limit?: number }, any>(
    "apiCommerce:getMyUsageStatus",
  ),
  reverseCommandUsage: makeFunctionReference<"mutation", any, any>(
    "apiCommerce:reverseCommandUsage",
  ),
  enqueueBillingOutbox: makeFunctionReference<"mutation", any, any>(
    "apiCommerce:enqueueBillingOutbox",
  ),
} as const;

function setup() {
  return convexTest(schema, modules);
}

async function fixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      username: "commerce-owner",
      usernameNormalized: "commerce-owner",
      role: "owner",
    });
    const otherOwnerId = await ctx.db.insert("users", {
      name: "Other",
      username: "commerce-other",
      usernameNormalized: "commerce-other",
      role: "reader",
    });
    const agentId = await ctx.db.insert("users", {
      name: "Evidence Agent",
      username: "evidence-agent",
      usernameNormalized: "evidence-agent",
      role: "reader",
      isAgent: true,
      agentSlug: "evidence-agent",
      agentStatus: "active",
      agentScopes: ["evidence"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1,
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "evidence-agent",
      userId: agentId,
      ownerUserId: ownerId,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: ["evidence"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { ownerId, otherOwnerId, agentId };
  });
}

const commandArgs = {
  agentId: "evidence-agent",
  productKey: "evidence-beta",
  idempotencyKey: "command-1",
  requestFingerprint: "sha256:command-one",
  operation: "evidence.search",
  units: 2,
  metadataJson: JSON.stringify({ source: "test" }),
};

describe("disabled billing and entitlement foundation", () => {
  test("replays same fingerprint without duplicate usage and rejects mismatches", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.mutation(commerce.seedDefaultProducts, {});
    const owner = t.withIdentity({ subject: ids.ownerId });
    const first = await owner.mutation(
      commerce.beginOrReplayCommand,
      commandArgs,
    );
    const replay = await owner.mutation(
      commerce.beginOrReplayCommand,
      commandArgs,
    );
    expect(first).toMatchObject({ idempotent: false, billingEnabled: false });
    expect(replay).toMatchObject({
      commandId: first.commandId,
      idempotent: true,
    });
    await expect(
      owner.mutation(commerce.beginOrReplayCommand, {
        ...commandArgs,
        requestFingerprint: "sha256:different",
      }),
    ).rejects.toThrow(/different request fingerprint/i);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("apiUsageLedger").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entryType).toBe("debit");
    });
  });

  test("lets an enrolled agent use only its owner-scoped commerce account", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.mutation(commerce.seedDefaultProducts, {});
    const agent = t.withIdentity({ subject: ids.agentId });
    const command = await agent.mutation(
      commerce.beginOrReplayCommand,
      commandArgs,
    );
    const replay = await agent.mutation(
      commerce.beginOrReplayCommand,
      commandArgs,
    );
    expect(command).toMatchObject({ idempotent: false, billingEnabled: false });
    expect(replay).toMatchObject({
      commandId: command.commandId,
      idempotent: true,
    });
    expect(await agent.query(commerce.getMyEntitlements, {})).toEqual([]);
    expect(await agent.query(commerce.getMyUsageStatus, {})).toHaveLength(1);
    await t.run(async (ctx) => {
      const ledger = await ctx.db.query("apiUsageLedger").unique();
      expect(ledger?.ownerUserId).toBe(ids.ownerId);
      expect(ledger?.agentId).toBe("evidence-agent");
    });
  });

  test("extends the free beta grant only to unpriced public evidence products", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiProducts", {
        productKey: "evidence-search",
        name: "Evidence search",
        description: "Test",
        status: "active",
        visibility: "public",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const agent = t.withIdentity({ subject: ids.agentId });
    await expect(
      agent.mutation(commerce.beginOrReplayCommand, {
        ...commandArgs,
        productKey: "evidence-search",
      }),
    ).resolves.toMatchObject({ idempotent: false, billingEnabled: false });
    expect(await agent.query(commerce.getMyAccessSummary, {})).toEqual([
      expect.objectContaining({
        productKey: "evidence-search",
        status: "active",
        grant: "free-beta",
        billingEnabled: false,
      }),
    ]);
    await t.run(async (ctx) => {
      const product = await ctx.db
        .query("apiProducts")
        .withIndex("by_productKey", (q) =>
          q.eq("productKey", "evidence-search"),
        )
        .unique();
      await ctx.db.patch("apiProducts", product!._id, { unitPriceMicroUsd: 1 });
    });
    await expect(
      agent.mutation(commerce.beginOrReplayCommand, {
        ...commandArgs,
        idempotencyKey: "command-2",
        requestFingerprint: "sha256:command-two",
        productKey: "evidence-search",
      }),
    ).rejects.toThrow(/active entitlement/i);
    expect(await agent.query(commerce.getMyAccessSummary, {})).toEqual([
      expect.objectContaining({
        productKey: "evidence-search",
        status: "denied",
        grant: "none",
        billingEnabled: false,
      }),
    ]);
  });

  test("enforces owner isolation and denies revoked or expired entitlements", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.mutation(commerce.seedDefaultProducts, {});
    const owner = t.withIdentity({ subject: ids.ownerId });
    const other = t.withIdentity({ subject: ids.otherOwnerId });
    await expect(
      other.mutation(commerce.beginOrReplayCommand, commandArgs),
    ).rejects.toThrow(/Active owned agent/i);
    await t.run(async (ctx) => {
      const product = await ctx.db
        .query("apiProducts")
        .withIndex("by_productKey", (q) => q.eq("productKey", "evidence-beta"))
        .unique();
      await ctx.db.insert("apiEntitlements", {
        ownerUserId: ids.ownerId,
        productId: product!._id,
        status: "revoked",
        startsAt: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      owner.mutation(commerce.beginOrReplayCommand, commandArgs),
    ).rejects.toThrow(/active entitlement/i);
    await t.run(async (ctx) => {
      const entitlement = await ctx.db
        .query("apiEntitlements")
        .withIndex("by_ownerUserId_and_productId", (q) =>
          q.eq("ownerUserId", ids.ownerId),
        )
        .unique();
      await ctx.db.patch("apiEntitlements", entitlement!._id, {
        status: "active",
        expiresAt: 1,
      });
    });
    await expect(
      owner.mutation(commerce.beginOrReplayCommand, commandArgs),
    ).rejects.toThrow(/active entitlement/i);
  });

  test("uses append-only reversal entries and deduplicates outbox events", async () => {
    const t = setup();
    const ids = await fixture(t);
    await t.mutation(commerce.seedDefaultProducts, {});
    const owner = t.withIdentity({ subject: ids.ownerId });
    const command = await owner.mutation(
      commerce.beginOrReplayCommand,
      commandArgs,
    );
    const first = await t.mutation(commerce.reverseCommandUsage, {
      commandId: command.commandId as Id<"apiCommands">,
      reason: "request-failed",
    });
    const replay = await t.mutation(commerce.reverseCommandUsage, {
      commandId: command.commandId as Id<"apiCommands">,
      reason: "request-failed",
    });
    expect(replay).toMatchObject({
      ledgerEntryId: first.ledgerEntryId,
      idempotent: true,
    });
    const outbox = await t.mutation(commerce.enqueueBillingOutbox, {
      eventKey: "entitlement:command-1",
      kind: "entitlement",
      payloadJson: "{}",
    });
    const outboxReplay = await t.mutation(commerce.enqueueBillingOutbox, {
      eventKey: "entitlement:command-1",
      kind: "entitlement",
      payloadJson: "{}",
    });
    expect(outboxReplay).toMatchObject({
      outboxId: outbox.outboxId,
      idempotent: true,
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("apiUsageLedger").collect();
      expect(rows.map((row) => row.entryType).sort()).toEqual([
        "debit",
        "reversal",
      ]);
    });
  });
});
