/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { parseAllowedHosts, validateWebhookUrl } from "./evidenceWebhooks";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const webhooks = {
  create: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:createSubscription",
  ),
  list: makeFunctionReference<"query", Record<string, never>, any>(
    "evidenceWebhooks:listMySubscriptions",
  ),
  status: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:setSubscriptionStatus",
  ),
  rotate: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:rotateSigningSecret",
  ),
  history: makeFunctionReference<"query", any, any>(
    "evidenceWebhooks:listDeliveryHistory",
  ),
  health: makeFunctionReference<"query", any, any>(
    "evidenceWebhooks:getSubscriptionHealth",
  ),
  replay: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:replayDelivery",
  ),
  enqueue: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:enqueueEvent",
  ),
  recover: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:recoverPendingDeliveries",
  ),
  mark: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:markDelivery",
  ),
  deliver: makeFunctionReference<"action", any, any>(
    "evidenceWebhookActions:deliver",
  ),
} as const;

function setup() {
  const t = convexTest(schema, modules);
  createdTests.add(t);
  return t;
}

const createdTests = new Set<ReturnType<typeof setup>>();

afterEach(async () => {
  const tests = [...createdTests];
  createdTests.clear();
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.useFakeTimers();
  try {
    for (const t of tests) {
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    }
  } finally {
    fetchMock.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

async function fixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      name: "Webhook owner",
      username: "webhook-owner",
      usernameNormalized: "webhook-owner",
      role: "owner",
    });
    const other = await ctx.db.insert("users", {
      name: "Other owner",
      username: "webhook-other",
      usernameNormalized: "webhook-other",
      role: "reader",
    });
    const agent = await ctx.db.insert("users", {
      name: "Webhook agent",
      username: "webhook-agent",
      usernameNormalized: "webhook-agent",
      role: "reader",
      isAgent: true,
      agentSlug: "webhook-agent",
      agentStatus: "active",
      agentScopes: ["evidence"],
      agentKeyVersion: 1,
      agentEnrolledAt: 1,
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "webhook-agent",
      userId: agent,
      ownerUserId: owner,
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      scopes: ["evidence"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { owner, other, agent };
  });
}

const subscriptionArgs = {
  subscriptionKey: "research-events",
  url: "https://hooks.example.test/v1/evidence",
  eventTypes: ["evidence.research.completed"] as const,
};

function webhookCallsForEvent(
  fetchMock: any,
  eventKey: string,
) {
  return fetchMock.mock.calls.filter(
    ([url, init]: [string | URL | Request, RequestInit | undefined]) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      return (
        url === subscriptionArgs.url &&
        headers.get("x-symbaiex-event-id") === eventKey
      );
    },
  );
}

async function enqueueFixtureDelivery(
  t: ReturnType<typeof setup>,
  eventKey: string,
) {
  const ids = await fixture(t);
  await t
    .withIdentity({ subject: ids.agent })
    .mutation(webhooks.create, subscriptionArgs);
  await t.mutation(webhooks.enqueue, {
    eventKey,
    eventType: "evidence.research.completed",
    payloadJson: JSON.stringify({ researchJobId: eventKey, status: "completed" }),
  });
  return await t.run(async (ctx) => {
    const delivery = await ctx.db
      .query("apiWebhookDeliveries")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (delivery === null) throw new Error("Expected webhook delivery fixture");
    return delivery;
  });
}

async function insertClaimedDeliveryFixture(
  t: ReturnType<typeof setup>,
  eventKey: string,
) {
  const ids = await fixture(t);
  await t
    .withIdentity({ subject: ids.agent })
    .mutation(webhooks.create, subscriptionArgs);
  return await t.run(async (ctx) => {
    const subscription = await ctx.db
      .query("apiWebhookSubscriptions")
      .withIndex("by_ownerUserId_and_subscriptionKey", (q) =>
        q.eq("ownerUserId", ids.owner).eq("subscriptionKey", "research-events"),
      )
      .unique();
    if (subscription === null) {
      throw new Error("Expected webhook subscription fixture");
    }
    const now = Date.now();
    await ctx.db.insert("apiWebhookEvents", {
      provider: "evidence-delivery",
      eventKey,
      payloadJson: JSON.stringify({
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({
          researchJobId: eventKey,
          status: "completed",
        }),
      }),
      receivedAt: now,
    });
    const deliveryId = await ctx.db.insert("apiWebhookDeliveries", {
      subscriptionId: subscription._id,
      eventKey,
      status: "in_flight",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
      leaseExpiresAt: now + 30_000,
      deliveryGeneration: 1,
    });
    const delivery = await ctx.db.get("apiWebhookDeliveries", deliveryId);
    if (delivery === null) {
      throw new Error("Expected claimed webhook delivery fixture");
    }
    return delivery;
  });
}

describe("evidence webhooks", () => {
  test("does not persist delivery events when no subscriber can receive them", async () => {
    const t = setup();
    const result = await t.mutation(webhooks.enqueue, {
      eventKey: "research:nobody",
      eventType: "evidence.research.completed",
      payloadJson: JSON.stringify({ status: "completed" }),
    });
    expect(result).toEqual({ eventId: null, enqueued: 0 });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("apiWebhookEvents").take(1)).toEqual([]);
    });
  });

  test("is disabled without an allowlist and validates exact public HTTPS destinations", async () => {
    expect(parseAllowedHosts(undefined)).toEqual(new Set());
    expect(() =>
      validateWebhookUrl("https://hooks.example.test", new Set()),
    ).toThrow(/not enabled/i);
    const allowed = parseAllowedHosts("hooks.example.test");
    expect(validateWebhookUrl(subscriptionArgs.url, allowed)).toBe(
      subscriptionArgs.url,
    );
    for (const invalid of [
      "http://hooks.example.test/v1",
      "https://127.0.0.1/v1",
      "https://localhost/v1",
      "https://hooks.example.test@evil.example/v1",
      "https://other.example.test/v1",
    ]) {
      expect(() => validateWebhookUrl(invalid, allowed)).toThrow(/HTTPS/i);
    }
  });

  test("owner and enrolled evidence agent share only their owner-scoped subscriptions", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    try {
      const t = setup();
      const ids = await fixture(t);
      const owner = t.withIdentity({ subject: ids.owner });
      const agent = t.withIdentity({ subject: ids.agent });
      const other = t.withIdentity({ subject: ids.other });
      const created = await agent.mutation(webhooks.create, subscriptionArgs);
      expect(created).toMatchObject({
        subscriptionKey: "research-events",
        status: "active",
      });
      expect(created.signingSecret).toEqual(expect.any(String));
      expect(await owner.query(webhooks.list, {})).not.toContainEqual(
        expect.objectContaining({ signingSecret: expect.anything() }),
      );
      const rotated = await owner.mutation(webhooks.rotate, {
        subscriptionKey: "research-events",
      });
      expect(rotated.signingSecret).not.toBe(created.signingSecret);
      expect(await owner.query(webhooks.list, {})).toHaveLength(1);
      await expect(
        agent.mutation(webhooks.create, subscriptionArgs),
      ).resolves.toMatchObject({ subscriptionId: created.subscriptionId });
      await expect(
        agent.mutation(webhooks.create, {
          ...subscriptionArgs,
          url: "https://hooks.example.test/other",
        }),
      ).rejects.toThrow(/different URL or event set/i);
      expect(await agent.query(webhooks.list, {})).toHaveLength(1);
      expect(await other.query(webhooks.list, {})).toEqual([]);
      await expect(
        other.mutation(webhooks.status, {
          subscriptionKey: "research-events",
          status: "paused",
        }),
      ).rejects.toThrow(/not found/i);
      await agent.mutation(webhooks.status, {
        subscriptionKey: "research-events",
        status: "paused",
      });
      await agent.mutation(webhooks.status, {
        subscriptionKey: "research-events",
        status: "revoked",
      });
      await expect(
        owner.mutation(webhooks.status, {
          subscriptionKey: "research-events",
          status: "active",
        }),
      ).rejects.toThrow(/cannot be reactivated/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("idempotently enqueues only active matching deliveries", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    try {
      const t = setup();
      const ids = await fixture(t);
      const agent = t.withIdentity({ subject: ids.agent });
      await agent.mutation(webhooks.create, subscriptionArgs);
      const first = await t.mutation(webhooks.enqueue, {
        eventKey: "research:one",
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({
          researchJobId: "job-one",
          status: "completed",
        }),
      });
      const replay = await t.mutation(webhooks.enqueue, {
        eventKey: "research:one",
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({
          researchJobId: "job-one",
          status: "completed",
        }),
      });
      expect(first.enqueued).toBe(1);
      expect(replay).toMatchObject({ eventId: first.eventId, enqueued: 0 });
      await t.run(async (ctx) => {
        expect(await ctx.db.query("apiWebhookEvents").collect()).toHaveLength(
          1,
        );
        expect(
          await ctx.db.query("apiWebhookDeliveries").collect(),
        ).toHaveLength(1);
      });
      const history = await agent.query(webhooks.history, {
        subscriptionKey: "research-events",
        limit: 1,
      });
      expect(history).toHaveLength(1);
      expect(await agent.query(webhooks.health, { subscriptionKey: "research-events" })).toMatchObject({ pending: 1 });
      const queued = await t.run(async (ctx) =>
        ctx.db
          .query("apiWebhookDeliveries")
          .withIndex("by_eventKey", (q) => q.eq("eventKey", "research:one"))
          .unique(),
      );
      if (queued === null) throw new Error("Expected queued webhook delivery");
      await t.mutation(webhooks.mark, {
        deliveryId: queued._id,
        deliveryGeneration: queued.deliveryGeneration,
        outcome: "permanent_failure",
        responseCode: 400,
      });
      await agent.mutation(webhooks.replay, {
        subscriptionKey: "research-events",
        eventKey: "research:one",
      });
      await expect(t.withIdentity({ subject: ids.other }).query(webhooks.history, {
        subscriptionKey: "research-events",
      })).rejects.toThrow(/not found/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("atomically claims a due delivery only once across recovery calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T18:00:00.000Z"));
    try {
      const t = setup();
      const deliveryId = await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", {
          name: "Recovery owner",
          username: "recovery-owner",
          usernameNormalized: "recovery-owner",
          role: "reader",
        });
        const subscriptionId = await ctx.db.insert("apiWebhookSubscriptions", {
          ownerUserId,
          subscriptionKey: "recovery",
          url: subscriptionArgs.url,
          status: "active",
          eventTypes: ["evidence.research.completed"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return await ctx.db.insert("apiWebhookDeliveries", {
          subscriptionId,
          eventKey: "research:recover-once",
          status: "pending",
          attempt: 0,
          nextAttemptAt: Date.now() - 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const results = await Promise.all([
        t.mutation(webhooks.recover, { limit: 10 }),
        t.mutation(webhooks.recover, { limit: 10 }),
      ]);
      expect(results.reduce((sum, result) => sum + result.rescheduled, 0)).toBe(1);
      await t.run(async (ctx) => {
        expect(await ctx.db.get("apiWebhookDeliveries", deliveryId)).toMatchObject({
          status: "in_flight",
          deliveryGeneration: 1,
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("recovery claims only due or lease-expired rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T18:10:00.000Z"));
    try {
      const t = setup();
      const ids = await t.run(async (ctx) => {
        const ownerUserId = await ctx.db.insert("users", {
          name: "Due filter owner",
          username: "due-filter-owner",
          usernameNormalized: "due-filter-owner",
          role: "reader",
        });
        const subscriptionId = await ctx.db.insert("apiWebhookSubscriptions", {
          ownerUserId,
          subscriptionKey: "due-filter",
          url: subscriptionArgs.url,
          status: "active",
          eventTypes: ["evidence.research.completed"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const due = await ctx.db.insert("apiWebhookDeliveries", {
          subscriptionId,
          eventKey: "research:due",
          status: "pending",
          attempt: 0,
          nextAttemptAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const future = await ctx.db.insert("apiWebhookDeliveries", {
          subscriptionId,
          eventKey: "research:future",
          status: "pending",
          attempt: 0,
          nextAttemptAt: Date.now() + 60_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        const expired = await ctx.db.insert("apiWebhookDeliveries", {
          subscriptionId,
          eventKey: "research:expired-lease",
          status: "in_flight",
          attempt: 1,
          deliveryGeneration: 7,
          nextAttemptAt: Date.now() - 60_000,
          leaseExpiresAt: Date.now() - 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return { due, expired, future };
      });

      await expect(t.mutation(webhooks.recover, { limit: 10 })).resolves.toEqual({
        rescheduled: 2,
        deadLettered: 0,
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.get("apiWebhookDeliveries", ids.due)).toMatchObject({
          status: "in_flight",
          deliveryGeneration: 1,
        });
        expect(await ctx.db.get("apiWebhookDeliveries", ids.expired)).toMatchObject({
          status: "in_flight",
          deliveryGeneration: 8,
        });
        const future = await ctx.db.get("apiWebhookDeliveries", ids.future);
        expect(future).toMatchObject({ status: "pending" });
        expect(future?.deliveryGeneration).toBeUndefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("ignores stale delivery completions after a newer generation is claimed", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T18:20:00.000Z"));
    try {
      const t = setup();
      const initial = await insertClaimedDeliveryFixture(
        t,
        "research:stale-generation",
      );
      await t.mutation(webhooks.mark, {
        deliveryId: initial._id,
        deliveryGeneration: initial.deliveryGeneration,
        outcome: "transient_failure",
        responseCode: 503,
        errorMessage: "temporary outage",
      });
      const claimed = await t.run(async (ctx) =>
        ctx.db.get("apiWebhookDeliveries", initial._id),
      );
      expect(claimed).toMatchObject({
        status: "in_flight",
        attempt: 1,
        deliveryGeneration: 2,
      });

      await t.mutation(webhooks.mark, {
        deliveryId: initial._id,
        deliveryGeneration: initial.deliveryGeneration,
        outcome: "delivered",
        responseCode: 204,
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.get("apiWebhookDeliveries", initial._id)).toEqual(
          claimed,
        );
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  test("dead-letters local permanent failures without retrying", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      const t = setup();
      const delivery = await insertClaimedDeliveryFixture(
        t,
        "research:invalid-kek",
      );
      vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "invalid");
      await t.action(webhooks.deliver, {
        deliveryId: delivery._id,
        deliveryGeneration: delivery.deliveryGeneration,
      });
      expect(
        webhookCallsForEvent(fetchMock, "research:invalid-kek"),
      ).toHaveLength(0);
      await t.run(async (ctx) => {
        const row = await ctx.db.get("apiWebhookDeliveries", delivery._id);
        expect(row).toMatchObject({
          status: "dead_letter",
          attempt: 1,
          deliveryGeneration: 1,
        });
        expect(row?.nextAttemptAt).toBeUndefined();
        expect(row?.leaseExpiresAt).toBeUndefined();
      });
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  test("retries only transient responses with 1, 2, and 4 second backoff", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    vi.useFakeTimers();
    const startedAt = Date.parse("2026-08-18T18:30:00.000Z");
    vi.setSystemTime(startedAt);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("temporary", { status: 503 }));
    try {
      const t = setup();
      const delivery = await insertClaimedDeliveryFixture(
        t,
        "research:transient-backoff",
      );
      vi.runAllTimers();
      expect(
        webhookCallsForEvent(fetchMock, "research:transient-backoff"),
      ).toHaveLength(0);
      fetchMock.mockClear();
      const expectedBackoffs = [1_000, 2_000, 4_000];
      let generation = delivery.deliveryGeneration!;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await t.action(webhooks.deliver, {
          deliveryId: delivery._id,
          deliveryGeneration: generation,
        });
        const row = await t.run(async (ctx) =>
          ctx.db.get("apiWebhookDeliveries", delivery._id),
        );
        expect(row).toMatchObject({
          status: "in_flight",
          attempt,
          deliveryGeneration: generation + 1,
        });
        expect(row!.nextAttemptAt! - row!.updatedAt).toBe(
          expectedBackoffs[attempt - 1],
        );
        expect(row!.leaseExpiresAt! - row!.nextAttemptAt!).toBe(30_000);
        vi.clearAllTimers();
        generation += 1;
        vi.setSystemTime(row!.nextAttemptAt!);
      }

      await t.action(webhooks.deliver, {
        deliveryId: delivery._id,
        deliveryGeneration: generation,
      });
      await t.run(async (ctx) => {
        const row = await ctx.db.get("apiWebhookDeliveries", delivery._id);
        expect(row).toMatchObject({
          status: "dead_letter",
          attempt: 4,
          deliveryGeneration: generation,
        });
        expect(row?.nextAttemptAt).toBeUndefined();
        expect(row?.leaseExpiresAt).toBeUndefined();
      });
      expect(
        webhookCallsForEvent(fetchMock, "research:transient-backoff"),
      ).toHaveLength(4);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  test("caps subscriptions per owner", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    try {
      const t = setup();
      const ids = await fixture(t);
      const owner = t.withIdentity({ subject: ids.owner });
      for (let index = 0; index < 10; index += 1) {
        await owner.mutation(webhooks.create, {
          ...subscriptionArgs,
          subscriptionKey: `research-events-${index}`,
        });
      }
      await expect(
        owner.mutation(webhooks.create, {
          ...subscriptionArgs,
          subscriptionKey: "research-events-over-limit",
        }),
      ).rejects.toThrow(/at most 10/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("rejects credential-shaped event payloads before scheduling", async () => {
    const t = setup();
    await expect(
      t.mutation(webhooks.enqueue, {
        eventKey: "claim:secret",
        eventType: "evidence.claim.verified",
        payloadJson: JSON.stringify({ accessToken: "never-send" }),
      }),
    ).rejects.toThrow(/credential-like/i);
  });
});
