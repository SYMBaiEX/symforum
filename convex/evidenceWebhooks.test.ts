/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

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
} as const;

function setup() {
  return convexTest(schema, modules);
}

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
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test-webhook-kek");
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
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test-webhook-kek");
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

  test("caps subscriptions per owner", async () => {
    vi.stubEnv("EVIDENCE_WEBHOOK_ALLOWED_HOSTS", "hooks.example.test");
    vi.stubEnv("EVIDENCE_WEBHOOK_KEK", "test-webhook-kek");
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
