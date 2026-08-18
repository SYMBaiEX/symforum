/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function seedFixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "Owner",
      username: "quota-owner",
      usernameNormalized: "quota-owner",
      role: "owner",
    });
    const agentOneUserId = await ctx.db.insert("users", {
      name: "Quota Agent One",
      username: "quota-agent-one",
      usernameNormalized: "quota-agent-one",
      role: "reader",
      isAgent: true,
      agentSlug: "quota-one",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1_800_000_000_000,
    });
    const agentTwoUserId = await ctx.db.insert("users", {
      name: "Quota Agent Two",
      username: "quota-agent-two",
      usernameNormalized: "quota-agent-two",
      role: "reader",
      isAgent: true,
      agentSlug: "quota-two",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1_800_000_000_000,
    });
    const identity = async (agentId: string, userId: Id<"users">) =>
      await ctx.db.insert("agentIdentities", {
        agentId,
        userId,
        ownerUserId,
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        scopes: ["forum"],
        status: "active",
        keyVersion: 1,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      });
    await identity("quota-one", agentOneUserId);
    await identity("quota-two", agentTwoUserId);
    return { ownerUserId, agentOneUserId, agentTwoUserId };
  });
}

describe("agent quota foundation", () => {
  test("owner-scoped configuration, free allowance metadata, and idempotent ledger writes", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    const owner = t.withIdentity({ subject: fixture.ownerUserId });

    await expect(
      owner.mutation(api.agentQuota.configureAgentQuota, {
        agentId: "quota-one",
        monthKey: "2026-08",
        freeAllowanceUnits: 2,
        hardCapUnits: 5,
        monthlyLimitUnits: 4,
        requestLimitUnits: 3,
        hardCapMetadataJson: JSON.stringify({
          source: "test",
          paymentProcessing: false,
        }),
      }),
    ).resolves.toMatchObject({
      freeAllowanceUnits: 2,
      hardCapUnits: 5,
      usedUnits: 0,
      hardCapMetadataJson: expect.stringContaining("paymentProcessing"),
    });

    const first = await t.mutation(internal.agentQuota.consumeAgentQuota, {
      agentId: "quota-one",
      units: 2,
      idempotencyKey: "request-1",
      operation: "forum.reply",
      monthKey: "2026-08",
    });
    expect(first).toMatchObject({
      accepted: true,
      idempotent: false,
      usedUnits: 2,
      agentUsedUnits: 2,
      remainingUnits: 3,
    });

    const replay = await t.mutation(internal.agentQuota.consumeAgentQuota, {
      agentId: "quota-one",
      units: 2,
      idempotencyKey: "request-1",
      operation: "forum.reply",
      monthKey: "2026-08",
    });
    expect(replay).toMatchObject({
      accepted: true,
      idempotent: true,
      usedUnits: 2,
      agentUsedUnits: 2,
    });

    await expect(
      t.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-one",
        units: 3,
        idempotencyKey: "request-1",
        operation: "forum.reply",
        monthKey: "2026-08",
      }),
    ).rejects.toThrow(/idempotencyKey was already used/i);

    const second = await t.mutation(internal.agentQuota.consumeAgentQuota, {
      agentId: "quota-one",
      units: 2,
      idempotencyKey: "request-2",
      operation: "forum.reply",
      monthKey: "2026-08",
    });
    expect(second).toMatchObject({ accepted: true, usedUnits: 4 });

    const overAgentLimit = await t.mutation(
      internal.agentQuota.consumeAgentQuota,
      {
        agentId: "quota-one",
        units: 1,
        idempotencyKey: "request-3",
        operation: "forum.reply",
        monthKey: "2026-08",
      },
    );
    expect(overAgentLimit).toMatchObject({
      accepted: false,
      reason: "agent-limit",
      usedUnits: 4,
    });
  });

  test("keeps old idempotency records replayable and binds new fingerprints", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("agentQuotaUsage", {
        ownerUserId: fixture.ownerUserId,
        agentId: "quota-one",
        monthKey: "2026-08",
        idempotencyKey: "legacy-request",
        operation: "forum.reply",
        units: 1,
        createdAt: 1_800_000_000_000,
      });
    });
    await expect(
      t.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-one",
        units: 1,
        idempotencyKey: "legacy-request",
        operation: "forum.reply",
        monthKey: "2026-08",
      }),
    ).resolves.toMatchObject({ accepted: true, idempotent: true });

    await t.mutation(internal.agentQuota.consumeAgentQuota, {
      agentId: "quota-one",
      units: 1,
      idempotencyKey: "fingerprint-request",
      operation: "forum.reply",
      monthKey: "2026-08",
      requestFingerprint: "sha256:abc123",
    });
    await expect(
      t.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-one",
        units: 1,
        idempotencyKey: "fingerprint-request",
        operation: "forum.reply",
        monthKey: "2026-08",
        requestFingerprint: "sha256:def456",
      }),
    ).rejects.toThrow(/idempotencyKey was already used/i);
  });

  test("hard caps reject usage and preserve a durable reached timestamp", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    const owner = t.withIdentity({ subject: fixture.ownerUserId });
    await owner.mutation(api.agentQuota.configureAgentQuota, {
      agentId: "quota-two",
      monthKey: "2026-08",
      freeAllowanceUnits: 1,
      hardCapUnits: 3,
      monthlyLimitUnits: 20,
      requestLimitUnits: 5,
    });

    await expect(
      t.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-two",
        units: 3,
        idempotencyKey: "cap-1",
        operation: "newsletter.send",
        monthKey: "2026-08",
        now: 1_800_000_100_000,
      }),
    ).resolves.toMatchObject({
      accepted: true,
      hardCapReached: true,
      usedUnits: 3,
      hardCapReachedAt: 1_800_000_100_000,
    });
    await expect(
      t.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-two",
        units: 1,
        idempotencyKey: "cap-2",
        operation: "newsletter.send",
        monthKey: "2026-08",
      }),
    ).resolves.toMatchObject({
      accepted: false,
      reason: "hard-cap",
      hardCapReached: true,
      hardCapReachedAt: 1_800_000_100_000,
    });
  });

  test("authenticated agent identity cannot spoof another agent id", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    const asAgentOne = t.withIdentity({ subject: fixture.agentOneUserId });

    await expect(
      asAgentOne.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-two",
        units: 1,
        idempotencyKey: "spoof-1",
        operation: "forum.reply",
        monthKey: "2026-08",
      }),
    ).rejects.toThrow(/does not match/i);

    await expect(
      asAgentOne.mutation(internal.agentQuota.consumeAgentQuota, {
        agentId: "quota-one",
        units: 1,
        idempotencyKey: "agent-1",
        operation: "forum.reply",
        monthKey: "2026-08",
      }),
    ).resolves.toMatchObject({ accepted: true, agentId: "quota-one" });
  });

  test("quota status is owner-scoped and active agent users can read their own status", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    const owner = t.withIdentity({ subject: fixture.ownerUserId });
    const agent = t.withIdentity({ subject: fixture.agentOneUserId });
    await owner.mutation(api.agentQuota.configureAgentQuota, {
      agentId: "quota-one",
      monthKey: "2026-08",
      freeAllowanceUnits: 2,
      hardCapUnits: 20,
      monthlyLimitUnits: 10,
      requestLimitUnits: 3,
    });
    await expect(
      owner.query(api.agentQuota.getAgentQuota, {
        agentId: "quota-one",
        monthKey: "2026-08",
      }),
    ).resolves.toMatchObject({ ownerUserId: fixture.ownerUserId });
    await expect(
      agent.query(api.agentQuota.getMyAgentQuota, { monthKey: "2026-08" }),
    ).resolves.toMatchObject({ agentId: "quota-one", monthKey: "2026-08" });
    await expect(
      t.query(api.agentQuota.getAgentQuota, {
        agentId: "quota-one",
        monthKey: "2026-08",
      }),
    ).rejects.toThrow(/sign in|owner/i);
  });

  test("uses the current UTC month for fresh quota status", async () => {
    const t = setup();
    const fixture = await seedFixture(t);
    const owner = t.withIdentity({ subject: fixture.ownerUserId });
    const agent = t.withIdentity({ subject: fixture.agentOneUserId });
    const monthKey = new Date().toISOString().slice(0, 7);
    await expect(
      owner.query(api.agentQuota.getAgentQuota, { agentId: "quota-one" }),
    ).resolves.toMatchObject({ monthKey, usedUnits: 0 });
    await expect(
      agent.query(api.agentQuota.getMyAgentQuota, {}),
    ).resolves.toMatchObject({
      monthKey,
      usedUnits: 0,
    });
  });
});
