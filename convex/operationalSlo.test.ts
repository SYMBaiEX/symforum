/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const evaluate = makeFunctionReference<
  "mutation",
  { now?: number },
  {
    enabled: boolean;
    evaluated: number;
    breached: number;
    healthy: number;
    unknown: number;
    truncated: boolean;
  }
>("operationalSlo:evaluate");
const summaryAdmin = makeFunctionReference<
  "query",
  Record<string, never>,
  { counts: { breached: number; healthy: number; unknown: number } }
>("operationalSlo:summaryAdmin");

afterEach(() => vi.unstubAllEnvs());

describe("Web Vitals operational SLO evaluator", () => {
  test("creates one breach log, avoids duplicate logs, and records recovery", async () => {
    vi.stubEnv("WEB_VITALS_SLO_ENABLED", "true");
    const now = 1_800_000_000_000;
    const t = convexTest(schema, modules);
    await insertSamples(t, now, 2_600);

    await expect(t.mutation(evaluate, { now })).resolves.toMatchObject({
      enabled: true,
      breached: 1,
    });
    await expect(
      t.mutation(evaluate, { now: now + 1_000 }),
    ).resolves.toMatchObject({
      breached: 1,
    });
    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query("systemLogs")
        .withIndex("by_fingerprint_and_createdAt", (q) =>
          q.eq("fingerprint", "web-vitals-slo:web-vitals-p75-v1:/:LCP:breach"),
        )
        .collect();
      expect(logs).toHaveLength(1);
      expect(logs[0]?.status).toBe("open");
    });

    await replaceLcpSamples(t, now + 2_000, 2_400);
    await expect(
      t.mutation(evaluate, { now: now + 3_000 }),
    ).resolves.toMatchObject({
      healthy: 1,
    });
    await t.run(async (ctx) => {
      const logs = await ctx.db.query("systemLogs").collect();
      expect(
        logs.filter((log) => log.eventType === "web_vitals_slo_breached"),
      ).toHaveLength(1);
      expect(
        logs.filter((log) => log.eventType === "web_vitals_slo_recovered"),
      ).toHaveLength(1);
      expect(
        logs.find((log) => log.eventType === "web_vitals_slo_breached")?.status,
      ).toBe("resolved");
    });
  });

  test("stores insufficient samples as unknown rather than green", async () => {
    vi.stubEnv("WEB_VITALS_SLO_ENABLED", "true");
    const now = 1_800_000_000_000;
    const t = convexTest(schema, modules);
    await insertSamples(t, now, 2_400, 19);

    await t.mutation(evaluate, { now });
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("webVitalSloStates")
        .withIndex("by_policyVersion_and_route_and_name", (q) =>
          q
            .eq("policyVersion", "web-vitals-p75-v1")
            .eq("route", "/")
            .eq("name", "LCP"),
        )
        .unique();
      expect(state).toMatchObject({
        status: "unknown",
        sampleCount: 19,
        breachActive: false,
      });
      expect(state?.p75).toBeUndefined();
    });
  });

  test("clears prior p75 metadata when samples become unknown without logging a false recovery", async () => {
    vi.stubEnv("WEB_VITALS_SLO_ENABLED", "true");
    const now = 1_800_000_000_000;
    const t = convexTest(schema, modules);
    await insertSamples(t, now, 2_600);
    await t.mutation(evaluate, { now });

    await removeLcpSamples(t);
    await t.mutation(evaluate, { now: now + 1_000 });
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("webVitalSloStates")
        .withIndex("by_policyVersion_and_route_and_name", (q) =>
          q
            .eq("policyVersion", "web-vitals-p75-v1")
            .eq("route", "/")
            .eq("name", "LCP"),
        )
        .unique();
      expect(state).toMatchObject({
        status: "unknown",
        sampleCount: 0,
        breachActive: true,
      });
      expect(state?.p75).toBeUndefined();
      expect(state?.lastSampleAt).toBeUndefined();

      const logs = await ctx.db.query("systemLogs").collect();
      expect(
        logs.filter((log) => log.eventType === "web_vitals_slo_breached"),
      ).toHaveLength(1);
      expect(
        logs.filter((log) => log.eventType === "web_vitals_slo_recovered"),
      ).toHaveLength(0);
      expect(logs[0]?.status).toBe("open");
    });
  });

  test("is disabled by default and keeps admin summary admin-only", async () => {
    const now = 1_800_000_000_000;
    const t = convexTest(schema, modules);
    await insertSamples(t, now, 2_600);
    await expect(t.mutation(evaluate, { now })).resolves.toEqual({
      enabled: false,
      evaluated: 0,
      breached: 0,
      healthy: 0,
      unknown: 0,
      truncated: false,
    });
    await expect(t.query(summaryAdmin, {})).rejects.toThrow(/sign in/i);
    const ownerId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Owner",
        username: "owner",
        usernameNormalized: "owner",
        role: "owner",
      }),
    );
    await expect(
      t.withIdentity({ subject: ownerId }).query(summaryAdmin, {}),
    ).resolves.toMatchObject({
      counts: { breached: 0, healthy: 0, unknown: 0 },
    });
  });
});

async function insertSamples(
  t: ReturnType<typeof convexTest>,
  now: number,
  value: number,
  count = 20,
) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert("webVitalEvents", {
        route: "/",
        name: "LCP",
        value,
        rating: "poor",
        navigationType: "navigate",
        timestamp: now - index,
        dedupeKey: `lcp-${value}-${index}`,
        createdAt: now - index,
      });
    }
  });
}

async function replaceLcpSamples(
  t: ReturnType<typeof convexTest>,
  now: number,
  value: number,
) {
  await removeLcpSamples(t);
  await insertSamples(t, now, value);
}

async function removeLcpSamples(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const events = (await ctx.db.query("webVitalEvents").collect()).filter(
      (event) => event.route === "/" && event.name === "LCP",
    );
    await Promise.all(
      events.map((event) => ctx.db.delete("webVitalEvents", event._id)),
    );
  });
}
