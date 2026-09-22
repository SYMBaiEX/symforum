/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
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
  start: makeFunctionReference<"mutation", any, any>(
    "evidenceWebhooks:startDeliveryAttempt",
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

function webhookCallsForEvent(fetchMock: any, eventKey: string) {
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
    payloadJson: JSON.stringify({
      researchJobId: eventKey,
      status: "completed",
    }),
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

async function insertScheduledDeliveryFixture(
  t: ReturnType<typeof setup>,
  eventKey: string,
) {
  const delivery = await insertClaimedDeliveryFixture(t, eventKey);
  await t.run((ctx) =>
    ctx.db.patch("apiWebhookDeliveries", delivery._id, {
      status: "pending",
      leaseExpiresAt: undefined,
    }),
  );
  return {
    ...delivery,
    status: "pending" as const,
    leaseExpiresAt: undefined,
  };
}

describe("evidence webhooks", () => {
  test("deduplicates owner-scoped usage threshold events without sensitive fields", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    const t = setup();
    const ids = await fixture(t);
    await t.withIdentity({ subject: ids.agent }).mutation(webhooks.create, {
      subscriptionKey: "usage-events",
      url: subscriptionArgs.url,
      eventTypes: ["evidence.usage.threshold_reached"],
    });
    const payloadJson = JSON.stringify({
      scope: "account",
      period: "2026-08",
      usedUnits: 80,
      hardCapUnits: 100,
      remainingUnits: 20,
      thresholdPercent: 80,
    });
    const first = await t.mutation(webhooks.enqueue, {
      eventKey: "usage:owner-scope:2026-08:threshold-80",
      eventType: "evidence.usage.threshold_reached",
      payloadJson,
      ownerUserId: ids.owner,
    });
    const replay = await t.mutation(webhooks.enqueue, {
      eventKey: "usage:owner-scope:2026-08:threshold-80",
      eventType: "evidence.usage.threshold_reached",
      payloadJson,
      ownerUserId: ids.owner,
    });
    expect(first.enqueued).toBe(1);
    expect(replay.enqueued).toBe(0);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("apiWebhookEvents").collect()).toHaveLength(1);
      expect(await ctx.db.query("apiWebhookDeliveries").collect()).toHaveLength(
        1,
      );
      const event = await ctx.db.query("apiWebhookEvents").unique();
      expect(event?.payloadJson).not.toMatch(/token|secret|price|request/i);
    });
  });

  test("isolates account events by owner while preserving global fanout and replay idempotence", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    const t = setup();
    const a = await fixture(t);
    const b = await fixture(t);
    const eventTypes = [
      "evidence.usage.threshold_reached",
      "evidence.entitlement.status_changed",
      "evidence.research.completed",
    ] as const;
    await t.withIdentity({ subject: a.agent }).mutation(webhooks.create, {
      subscriptionKey: "a-events",
      url: subscriptionArgs.url,
      eventTypes,
    });
    await t.withIdentity({ subject: b.agent }).mutation(webhooks.create, {
      subscriptionKey: "b-events",
      url: subscriptionArgs.url,
      eventTypes,
    });
    const payloadJson = JSON.stringify({
      scope: "account",
      period: "2026-08",
      usedUnits: 80,
      hardCapUnits: 100,
      remainingUnits: 20,
      thresholdPercent: 80,
    });
    const first = await t.mutation(webhooks.enqueue, {
      eventKey: "usage:owner-a:threshold",
      eventType: "evidence.usage.threshold_reached",
      payloadJson,
      ownerUserId: a.owner,
    });
    const replay = await t.mutation(webhooks.enqueue, {
      eventKey: "usage:owner-a:threshold",
      eventType: "evidence.usage.threshold_reached",
      payloadJson,
      ownerUserId: a.owner,
    });
    expect(first.enqueued).toBe(1);
    expect(replay.enqueued).toBe(0);
    const entitlement = await t.mutation(webhooks.enqueue, {
      eventKey: "entitlement:owner-a:version-1",
      eventType: "evidence.entitlement.status_changed",
      payloadJson: JSON.stringify({
        scope: "account",
        productKey: "evidence-beta",
        status: "active",
        startsAt: 1_700_000_000,
      }),
      ownerUserId: a.owner,
    });
    expect(entitlement.enqueued).toBe(1);
    const global = await t.mutation(webhooks.enqueue, {
      eventKey: "research:global",
      eventType: "evidence.research.completed",
      payloadJson: JSON.stringify({ status: "completed" }),
    });
    expect(global.enqueued).toBe(2);
    await t.run(async (ctx) => {
      const subscriptions = await ctx.db
        .query("apiWebhookSubscriptions")
        .collect();
      const deliveries = await ctx.db.query("apiWebhookDeliveries").collect();
      const aSubscription = subscriptions.find(
        (item) => item.ownerUserId === a.owner,
      );
      const bSubscription = subscriptions.find(
        (item) => item.ownerUserId === b.owner,
      );
      expect(aSubscription).toBeDefined();
      expect(bSubscription).toBeDefined();
      expect(
        deliveries.filter((item) => item.subscriptionId === aSubscription!._id),
      ).toHaveLength(3);
      expect(
        deliveries.filter((item) => item.subscriptionId === bSubscription!._id),
      ).toHaveLength(1);
      expect(
        deliveries.filter(
          (item) => item.eventKey === "usage:owner-a:threshold",
        ),
      ).toHaveLength(1);
    });
  });

  test("fails closed when account scope is missing or attached to a global event", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    const t = setup();
    const ids = await fixture(t);
    await t.withIdentity({ subject: ids.agent }).mutation(webhooks.create, {
      subscriptionKey: "usage-events",
      url: subscriptionArgs.url,
      eventTypes: [
        "evidence.usage.threshold_reached",
        "evidence.research.completed",
      ],
    });
    const payloadJson = JSON.stringify({
      scope: "account",
      period: "2026-08",
      usedUnits: 80,
      hardCapUnits: 100,
      remainingUnits: 20,
      thresholdPercent: 80,
    });
    await expect(
      t.mutation(webhooks.enqueue, {
        eventKey: "usage:missing-owner",
        eventType: "evidence.usage.threshold_reached",
        payloadJson,
      }),
    ).rejects.toThrow(/owner scope/i);
    await expect(
      t.mutation(webhooks.enqueue, {
        eventKey: "research:owner-supplied",
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({ status: "completed" }),
        ownerUserId: ids.owner,
      }),
    ).rejects.toThrow(/global webhook events/i);
  });

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
      expect(
        await agent.query(webhooks.health, {
          subscriptionKey: "research-events",
        }),
      ).toMatchObject({ pending: 1 });
      const queued = await t.run(async (ctx) =>
        ctx.db
          .query("apiWebhookDeliveries")
          .withIndex("by_eventKey", (q) => q.eq("eventKey", "research:one"))
          .unique(),
      );
      if (queued === null) throw new Error("Expected queued webhook delivery");
      await expect(
        t.mutation(webhooks.start, {
          deliveryId: queued._id,
          deliveryGeneration: queued.deliveryGeneration,
        }),
      ).resolves.toBe(true);
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
      await expect(
        t.withIdentity({ subject: ids.other }).query(webhooks.history, {
          subscriptionKey: "research-events",
        }),
      ).rejects.toThrow(/not found/i);
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
          nextAttemptAt: Date.now() - 30_001,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const results = await Promise.all([
        t.mutation(webhooks.recover, { limit: 10 }),
        t.mutation(webhooks.recover, { limit: 10 }),
      ]);
      expect(results.reduce((sum, result) => sum + result.rescheduled, 0)).toBe(
        1,
      );
      await t.run(async (ctx) => {
        expect(
          await ctx.db.get("apiWebhookDeliveries", deliveryId),
        ).toMatchObject({
          status: "pending",
          deliveryGeneration: 1,
          attempt: 0,
        });
        expect(
          (await ctx.db.get("apiWebhookDeliveries", deliveryId))
            ?.leaseExpiresAt,
        ).toBeUndefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("scheduler delay rotates pending work without consuming delivery attempts", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T18:05:00.000Z"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const t = setup();
      const initial = await enqueueFixtureDelivery(
        t,
        "research:scheduler-delayed",
      );
      expect(initial).toMatchObject({
        status: "pending",
        attempt: 0,
        deliveryGeneration: 1,
      });
      expect(initial.leaseExpiresAt).toBeUndefined();

      for (let delayed = 0; delayed < 5; delayed += 1) {
        vi.setSystemTime(Date.now() + 31_000);
        await expect(
          t.mutation(webhooks.recover, { limit: 10 }),
        ).resolves.toMatchObject({ rescheduled: 1, deadLettered: 0 });
        const pending = await t.run((ctx) =>
          ctx.db.get("apiWebhookDeliveries", initial._id),
        );
        expect(pending).toMatchObject({
          status: "pending",
          attempt: 0,
          deliveryGeneration: delayed + 2,
        });
        expect(pending?.leaseExpiresAt).toBeUndefined();
      }

      const current = await t.run((ctx) =>
        ctx.db.get("apiWebhookDeliveries", initial._id),
      );
      // An action that was delayed past a recovery generation cannot claim the
      // row or issue a duplicate HTTP request when it finally wakes up.
      await t.action(webhooks.deliver, {
        deliveryId: initial._id,
        deliveryGeneration: initial.deliveryGeneration,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", initial._id)),
      ).toMatchObject({
        status: "pending",
        attempt: 0,
        deliveryGeneration: current!.deliveryGeneration,
      });
      await t.action(webhooks.deliver, {
        deliveryId: initial._id,
        deliveryGeneration: current!.deliveryGeneration,
      });
      expect(
        await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", initial._id)),
      ).toMatchObject({ status: "delivered", attempt: 1 });
      expect(
        webhookCallsForEvent(fetchMock, "research:scheduler-delayed"),
      ).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
      vi.unstubAllEnvs();
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
          nextAttemptAt: Date.now() - 30_001,
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

      await expect(
        t.mutation(webhooks.recover, { limit: 10 }),
      ).resolves.toEqual({
        rescheduled: 2,
        deadLettered: 0,
      });
      await t.run(async (ctx) => {
        expect(await ctx.db.get("apiWebhookDeliveries", ids.due)).toMatchObject(
          {
            status: "pending",
            deliveryGeneration: 1,
            attempt: 0,
          },
        );
        expect(
          await ctx.db.get("apiWebhookDeliveries", ids.expired),
        ).toMatchObject({
          status: "pending",
          deliveryGeneration: 8,
          attempt: 2,
        });
        const future = await ctx.db.get("apiWebhookDeliveries", ids.future);
        expect(future).toMatchObject({ status: "pending" });
        expect(future?.deliveryGeneration).toBeUndefined();
      });
      const recoverLease = internal.evidenceWebhooks.recoverDeliveryLease;
      // An old scheduled wake-up cannot steal the current attempt.
      await t.mutation(recoverLease, {
        deliveryId: ids.expired,
        deliveryGeneration: 7,
      });
      expect(
        (await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", ids.expired)))
          ?.deliveryGeneration,
      ).toBe(8);
      // Starting the worker, not scheduling it, creates the current lease.
      await expect(
        t.mutation(webhooks.start, {
          deliveryId: ids.expired,
          deliveryGeneration: 8,
        }),
      ).resolves.toBe(true);
      await expect(
        t.mutation(webhooks.start, {
          deliveryId: ids.expired,
          deliveryGeneration: 8,
        }),
      ).resolves.toBe(false);
      // Nor can a current wake-up run before the started lease expires.
      await t.mutation(recoverLease, {
        deliveryId: ids.expired,
        deliveryGeneration: 8,
      });
      expect(
        (await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", ids.expired)))
          ?.deliveryGeneration,
      ).toBe(8);
      await t.run((ctx) =>
        ctx.db.patch("apiWebhookDeliveries", ids.expired, {
          leaseExpiresAt: Date.now() - 1,
        }),
      );
      await t.mutation(recoverLease, {
        deliveryId: ids.expired,
        deliveryGeneration: 8,
      });
      expect(
        await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", ids.expired)),
      ).toMatchObject({ status: "pending", deliveryGeneration: 9, attempt: 3 });
      await expect(
        t.mutation(webhooks.start, {
          deliveryId: ids.expired,
          deliveryGeneration: 9,
        }),
      ).resolves.toBe(true);
      await t.run((ctx) =>
        ctx.db.patch("apiWebhookDeliveries", ids.expired, {
          leaseExpiresAt: Date.now() - 1,
        }),
      );
      await t.mutation(recoverLease, {
        deliveryId: ids.expired,
        deliveryGeneration: 9,
      });
      expect(
        await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", ids.expired)),
      ).toMatchObject({ status: "dead_letter", attempt: 4 });
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
        status: "pending",
        attempt: 1,
        deliveryGeneration: 2,
      });
      expect(claimed?.leaseExpiresAt).toBeUndefined();

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
      const delivery = await insertScheduledDeliveryFixture(
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

  test.each([
    "public",
    "private",
    "inactive-source",
    "watchlist",
    "claim-owner",
    "pending-sync",
  ] as const)(
    "checks current evidence visibility before delivery: %s",
    async (scenario) => {
      vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
      vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test_webhook_kek_0123456789abcdef");
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 204 }));
      const t = setup();
      const eventKey = `visibility:${scenario}`;
      const delivery = await insertScheduledDeliveryFixture(t, eventKey);
      await t.run(async (ctx) => {
        const sourceId = await ctx.db.insert("evidenceSources", {
          sourceKey: "symbaiex-first-party-research",
          name: "Research",
          sourceType: "manual",
          ingestionEnabled: true,
          baseUrl: "https://example.com",
          homepageUrl: "https://example.com",
          status: "active",
          licenseClass: "open",
          provenanceClass: "research",
          visibility: "public",
          termsUrl: "",
          etag: "",
          lastModified: "",
          cursor: "",
          lastFetchedAt: 0,
          lastSucceededAt: 0,
          lastErrorAt: 0,
          lastErrorMessage: "",
          createdAt: 1,
          updatedAt: 1,
        });
        const documentId = await ctx.db.insert("evidenceDocuments", {
          sourceId,
          externalKey:
            scenario === "claim-owner"
              ? "forum-research:missing-thread"
              : "public-page",
          canonicalUrl: "https://example.com/research",
          canonicalUrlHash: "hash",
          kind: "paper",
          visibility: "public",
          title: "Research",
          excerpt: "Public research",
          searchText: "research",
          tags: [],
          authors: [],
          licenseClass: "open",
          currentVersionId: null,
          publishedAt: 1,
          firstSeenAt: 1,
          updatedAt: 1,
        });
        let payload: Record<string, unknown> = { documentId };
        if (scenario === "watchlist")
          payload = { entityType: "document", entityId: documentId };
        if (scenario === "claim-owner") {
          const claimId = await ctx.db.insert("evidenceClaims", {
            claimKey: "symbaiex-forum-claim:missing-thread:historical",
            statement: "Claim",
            subjectEntityId: null,
            predicate: "is",
            objectText: "claim",
            status: "supported",
            confidence: 1,
            visibility: "public",
            observedAt: 1,
            createdAt: 1,
            updatedAt: 1,
          });
          payload = { entityType: "claim", entityId: claimId };
        }
        const event = await ctx.db
          .query("apiWebhookEvents")
          .withIndex("by_provider_and_eventKey", (q) =>
            q.eq("provider", "evidence-delivery").eq("eventKey", eventKey),
          )
          .unique();
        await ctx.db.patch("apiWebhookEvents", event!._id, {
          payloadJson: JSON.stringify({
            eventType: "evidence.document.changed",
            payloadJson: JSON.stringify(payload),
          }),
        });
        // The evidence was public when queued; access can change before the worker runs.
        if (["private", "watchlist", "claim-owner"].includes(scenario))
          await ctx.db.patch("evidenceDocuments", documentId, {
            visibility: "private",
          });
        if (scenario === "inactive-source")
          await ctx.db.patch("evidenceSources", sourceId, { status: "paused" });
        if (scenario === "pending-sync") {
          const categoryId = await ctx.db.insert("forumCategories", {
            name: "Research",
            slug: "research",
            description: "",
            position: 1,
            status: "active",
            threadCount: 0,
            postCount: 0,
            createdAt: 1,
            updatedAt: 1,
          });
          const authorUserId = await ctx.db.insert("users", { name: "Agent" });
          const threadId = await ctx.db.insert("forumThreads", {
            categoryId,
            categorySlug: "research",
            authorId: authorUserId,
            lastPostUserId: authorUserId,
            title: "Research",
            slug: "research",
            body: "Research",
            searchText: "research",
            status: "active",
            pinned: false,
            createdAt: 1,
            updatedAt: 1,
            lastPostAt: 1,
            replyCount: 0,
            viewCount: 0,
          });
          await ctx.db.patch("evidenceDocuments", documentId, {
            externalKey: `forum-research:${threadId}`,
          });
          await ctx.db.insert("evidenceFirstPartySyncQueue", {
            threadId,
            generation: 1,
            reason: "content_changed",
            enqueuedAt: 1,
            updatedAt: 1,
          });
        }
      });
      await t.action(webhooks.deliver, {
        deliveryId: delivery._id,
        deliveryGeneration: delivery.deliveryGeneration,
      });
      expect(webhookCallsForEvent(fetchMock, eventKey)).toHaveLength(
        scenario === "public" ? 1 : 0,
      );
      expect(
        await t.run((ctx) => ctx.db.get("apiWebhookDeliveries", delivery._id)),
      ).toMatchObject({
        status: scenario === "public" ? "delivered" : "dead_letter",
      });
    },
  );

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
      const delivery = await insertScheduledDeliveryFixture(
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
          status: "pending",
          attempt,
          deliveryGeneration: generation + 1,
        });
        expect(row!.nextAttemptAt! - row!.updatedAt).toBe(
          expectedBackoffs[attempt - 1],
        );
        expect(row?.leaseExpiresAt).toBeUndefined();
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
