/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import schema from "./schema";
import { dispatch, readBoundedResponse } from "./elizaShadow";
import {
  parseShadowInput,
  shadowBudgetMicroUsd,
  shadowWorkerOrigin,
} from "../lib/eliza-shadow-contract";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}
function enable(mode: "shadow" | "canary" = "shadow") {
  vi.stubEnv("ELIZA_SHADOW_MODE", mode);
  vi.stubEnv(
    "ELIZA_SHADOW_WORKER_SECRET",
    "test-only-shadow-secret-at-least-32-characters",
  );
  vi.stubEnv("ELIZA_SHADOW_WORKER_URL", "https://shadow-worker.up.railway.app");
  vi.stubEnv("ELIZA_SHADOW_DAILY_BUDGET_USD", "1");
  vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "10");
}
const packet = {
  version: 1,
  kind: "suki-reply" as const,
  system: "You are Suki.",
  prompt: "Public source context only.",
  schema: {
    type: "object",
    properties: { healthy: { type: "boolean" }, mode: { type: "string" } },
  },
};
function args(key = "fixture") {
  return {
    jobKey: key,
    kind: "suki-reply" as const,
    sourceRunKey: "live-run-private-reference",
    promptVersion: "fixture-v1",
    inputJson: JSON.stringify(packet),
    baselineJson: JSON.stringify({ secretBaseline: "DO_NOT_EXPORT" }),
    evaluationJson: JSON.stringify({ secretEvaluation: "DO_NOT_EXPORT" }),
  };
}
async function result(
  t: ReturnType<typeof setup>,
  jobId: Id<"elizaShadowJobs"> | undefined,
) {
  if (!jobId) throw new Error("missing fixture job");
  const doc = await t.run((ctx) => ctx.db.get("elizaShadowJobs", jobId));
  return {
    version: 1,
    jobId,
    inputHash: doc!.inputHash,
    output: { healthy: true, mode: "shadow" },
    model: "~deepseek/deepseek-v4-flash-latest",
    servedModel: "deepseek/deepseek-v4-flash",
    inputTokens: 100,
    outputTokens: 15,
    providerCostMicroUsd: 64,
    durationMs: 100,
    runtimeVersion: "1.7.2",
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ElizaOS shadow isolation", () => {
  test("disabled by default and no live mode exists", async () => {
    const t = setup();
    expect(await t.mutation(internal.elizaShadowData.enqueue, args())).toEqual({
      status: "disabled",
    });
    enable();
    vi.stubEnv("ELIZA_SHADOW_MODE", "live");
    expect(await t.mutation(internal.elizaShadowData.enqueue, args())).toEqual({
      status: "disabled",
    });
    expect(
      await t.run((ctx) => ctx.db.query("elizaShadowJobs").take(10)),
    ).toEqual([]);
  });

  test("immutable admission dedupes and rejects changed inputs", async () => {
    enable();
    const t = setup();
    const first = await t.mutation(internal.elizaShadowData.enqueue, args());
    expect(first.status).toBe("queued");
    expect(await t.mutation(internal.elizaShadowData.enqueue, args())).toEqual({
      status: "duplicate",
      jobId: first.jobId,
    });
    await expect(
      t.mutation(internal.elizaShadowData.enqueue, {
        ...args(),
        inputJson: JSON.stringify({ ...packet, prompt: "changed" }),
      }),
    ).rejects.toThrow("fingerprint_conflict");
    expect(
      await t.run((ctx) => ctx.db.query("elizaShadowJobs").take(10)),
    ).toHaveLength(1);
  });

  test.each(["suki-reply", "belle-newsletter"] as const)(
    "canary mode admits and claims only the synthetic %s lane",
    async (kind) => {
      enable("canary");
      const t = setup();
      expect(
        await t.mutation(internal.elizaShadowData.enqueue, {
          ...args(`organic-${kind}`),
          kind,
          inputJson: JSON.stringify({ ...packet, kind }),
        }),
      ).toEqual({ status: "disabled" });
      const canary = await t.mutation(internal.elizaShadowData.enqueueCanary, {
        kind,
        nonce: "canary-mode",
      });
      expect(canary.status).toBe("queued");
      const claim = await t.mutation(internal.elizaShadowData.claim, {
        jobId: canary.jobId!,
      });
      expect(claim).toMatchObject({ isCanary: true, maxOutputTokens: 128 });
      expect(JSON.parse(claim!.inputJson).kind).toBe(kind);
      expect(
        await t.run((ctx) => ctx.db.query("elizaShadowJobs").take(10)),
      ).toHaveLength(1);
      expect(await t.run((ctx) => ctx.db.query("forumPosts").take(1))).toEqual(
        [],
      );
      expect(
        await t.run((ctx) => ctx.db.query("newsletterIssues").take(1)),
      ).toEqual([]);
    },
  );

  test.each(["suki-reply", "belle-newsletter"] as const)(
    "canary mode refuses an already queued organic %s job before reservation",
    async (kind) => {
      enable();
      const t = setup();
      const queued = await t.mutation(internal.elizaShadowData.enqueue, {
        ...args(`queued-${kind}`),
        kind,
        inputJson: JSON.stringify({ ...packet, kind }),
      });
      expect(queued.status).toBe("queued");
      vi.stubEnv("ELIZA_SHADOW_MODE", "canary");
      expect(
        await t.mutation(internal.elizaShadowData.claim, {
          jobId: queued.jobId!,
        }),
      ).toBeNull();
      expect(
        (await t.run((ctx) => ctx.db.get("elizaShadowJobs", queued.jobId!)))
          ?.status,
      ).toBe("disabled");
      expect(
        await t.run((ctx) => ctx.db.query("aiModelCallReservations").take(10)),
      ).toEqual([]);
    },
  );

  test("bounds public/private packets and rejects wrong-kind packets", async () => {
    enable();
    const t = setup();
    await expect(
      t.mutation(internal.elizaShadowData.enqueue, {
        ...args(),
        inputJson: JSON.stringify({ ...packet, prompt: "x".repeat(103_000) }),
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.elizaShadowData.enqueue, {
        ...args(),
        baselineJson: JSON.stringify("x".repeat(165_000)),
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.elizaShadowData.enqueue, {
        ...args(),
        kind: "belle-newsletter",
      }),
    ).rejects.toThrow("kind_mismatch");
    expect(
      await t.run((ctx) => ctx.db.query("elizaShadowJobs").take(10)),
    ).toHaveLength(0);
  });

  test("per-kind daily capture limit is bounded", async () => {
    enable();
    const t = setup();
    for (let i = 0; i < 12; i++)
      expect(
        (await t.mutation(internal.elizaShadowData.enqueue, args(`run-${i}`)))
          .status,
      ).toBe("queued");
    expect(
      await t.mutation(internal.elizaShadowData.enqueue, args("overflow")),
    ).toEqual({ status: "limited" });
  });

  test("claim is single attempt, reserves globally, never retries", async () => {
    enable();
    const t = setup();
    const { jobId } = await t.mutation(
      internal.elizaShadowData.enqueue,
      args(),
    );
    const claims = await Promise.all([
      t.mutation(internal.elizaShadowData.claim, { jobId: jobId! }),
      t.mutation(internal.elizaShadowData.claim, { jobId: jobId! }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.isCanary).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("aiModelCallReservations").take(10)),
    ).toHaveLength(1);
    await t.mutation(internal.elizaShadowData.fail, {
      jobId: jobId!,
      errorCode: "worker_unavailable",
    });
    expect(
      await t.mutation(internal.elizaShadowData.claim, { jobId: jobId! }),
    ).toBeNull();
    const reservation = await t.run((ctx) =>
      ctx.db.query("aiModelCallReservations").first(),
    );
    expect(reservation?.status).toBe("reserved");
  });

  test("both budget switches fail closed before provider work", async () => {
    enable();
    const t = setup();
    const { jobId } = await t.mutation(
      internal.elizaShadowData.enqueue,
      args(),
    );
    vi.stubEnv("OPENROUTER_DAILY_BUDGET_USD", "0.00001");
    expect(
      await t.mutation(internal.elizaShadowData.claim, { jobId: jobId! }),
    ).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.get("elizaShadowJobs", jobId!)))?.errorCode,
    ).toBe("shared_model_budget");
    expect(
      await t.run((ctx) => ctx.db.query("aiModelCallReservations").take(10)),
    ).toHaveLength(0);
  });

  test("disable switch drains pending jobs without provider calls", async () => {
    enable();
    const t = setup();
    const { jobId } = await t.mutation(
      internal.elizaShadowData.enqueue,
      args(),
    );
    vi.stubEnv("ELIZA_SHADOW_MODE", "off");
    expect(
      await t.mutation(internal.elizaShadowData.claim, { jobId: jobId! }),
    ).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.get("elizaShadowJobs", jobId!)))?.status,
    ).toBe("disabled");
  });

  test("completion validates identity, settles once and disallows conflicting replay", async () => {
    enable();
    const t = setup();
    const { jobId } = await t.mutation(
      internal.elizaShadowData.enqueue,
      args(),
    );
    await t.mutation(internal.elizaShadowData.claim, { jobId: jobId! });
    const receipt = await result(t, jobId);
    await expect(
      t.mutation(internal.elizaShadowData.complete, {
        jobId: jobId!,
        resultJson: JSON.stringify({ ...receipt, inputHash: "a".repeat(64) }),
        comparisonJson: "{}",
      }),
    ).rejects.toThrow("mismatch");
    const complete = {
      jobId: jobId!,
      resultJson: JSON.stringify(receipt),
      comparisonJson: JSON.stringify({
        valid: true,
        publicationAllowed: false,
      }),
    };
    await t.mutation(internal.elizaShadowData.complete, complete);
    await t.mutation(internal.elizaShadowData.complete, complete);
    const reservation = await t.run((ctx) =>
      ctx.db.query("aiModelCallReservations").first(),
    );
    expect(reservation?.status).toBe("settled");
    await expect(
      t.mutation(internal.elizaShadowData.complete, {
        ...complete,
        resultJson: JSON.stringify({ ...receipt, output: { changed: true } }),
      }),
    ).rejects.toThrow("conflict");
    // This entire protocol has no forum/newsletter writes.
    expect(
      await t.run((ctx) => ctx.db.query("forumPosts").take(10)),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("newsletterIssues").take(10)),
    ).toHaveLength(0);
  });

  test("late completions cannot revive expired attempts", async () => {
    enable();
    const t = setup();
    const { jobId } = await t.mutation(
      internal.elizaShadowData.enqueue,
      args(),
    );
    await t.mutation(internal.elizaShadowData.claim, { jobId: jobId! });
    const receipt = await result(t, jobId);
    vi.setSystemTime(Date.now() + 181_000);
    await t.mutation(internal.elizaShadowData.expireRunning, { jobId: jobId! });
    await expect(
      t.mutation(internal.elizaShadowData.complete, {
        jobId: jobId!,
        resultJson: JSON.stringify(receipt),
        comparisonJson: "{}",
      }),
    ).rejects.toThrow("expired");
  });

  test("admin list rejects anonymous and keeps source bodies private", async () => {
    const t = setup();
    await expect(
      t.query(api.elizaShadowData.listAdmin, { kind: "suki-reply" }),
    ).rejects.toThrow();
    expect(
      await t.query(internal.elizaShadowData.inspect, { kind: "suki-reply" }),
    ).toEqual([]);
  });

  test.each([
    ["shadow", "suki-reply"],
    ["shadow", "belle-newsletter"],
    ["canary", "suki-reply"],
    ["canary", "belle-newsletter"],
  ] as const)(
    "%s mode dispatches the %s canary with only allowlisted input",
    async (mode, kind) => {
      enable(mode);
      const t = setup();
      const { jobId } = await t.mutation(
        internal.elizaShadowData.enqueueCanary,
        {
          kind,
          nonce: "e2e",
        },
      );
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          expect(Object.keys(request).sort()).toEqual(
            [
              "version",
              "kind",
              "system",
              "prompt",
              "schema",
              "jobId",
              "inputHash",
              "model",
              "maxOutputTokens",
            ].sort(),
          );
          expect(init?.redirect).toBe("error");
          return Response.json({
            version: 1,
            jobId: request.jobId,
            inputHash: request.inputHash,
            output: { healthy: true, mode: "shadow" },
            model: request.model,
            servedModel: request.model,
            inputTokens: 50,
            outputTokens: 15,
            durationMs: 10,
            runtimeVersion: "1.7.2",
          });
        });
      await t.action(internal.elizaShadow.dispatch, { jobId: jobId! });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const stored = await t.run((ctx) =>
        ctx.db.get("elizaShadowJobs", jobId!),
      );
      expect(stored?.status).toBe("completed");
      expect(JSON.parse(stored!.comparisonJson!)).toMatchObject({
        healthy: true,
        publicationAllowed: false,
      });
    },
  );

  test.each([false, undefined])(
    "dispatch rechecks canary mode against a claimed non-canary flag %s",
    async (isCanary) => {
      enable();
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Provider must not be called"));
      const runMutation = vi.fn(
        async (reference: Parameters<typeof getFunctionName>[0]) => {
          if (getFunctionName(reference) === "elizaShadowData:claim") {
            // Model the switch changing after admission but before dispatch sends.
            vi.stubEnv("ELIZA_SHADOW_MODE", "canary");
            return {
              inputJson: JSON.stringify(packet),
              inputHash: "a".repeat(64),
              model: "~deepseek/deepseek-v4-flash-latest",
              maxOutputTokens: 2_400,
              isCanary,
            };
          }
          return null;
        },
      );
      const ctx = { runMutation } as unknown as ActionCtx;
      await (
        dispatch as unknown as {
          _handler: (
            ctx: ActionCtx,
            args: { jobId: Id<"elizaShadowJobs"> },
          ) => Promise<null>;
        }
      )._handler(ctx, { jobId: "test-shadow-job" as Id<"elizaShadowJobs"> });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        runMutation.mock.calls.map(([reference]) => getFunctionName(reference)),
      ).toEqual(["elizaShadowData:claim", "elizaShadowData:fail"]);
    },
  );

  test("response limits apply without content-length and budget/config typos stop work", async () => {
    await expect(
      readBoundedResponse(new Response("x".repeat(20)), 10),
    ).rejects.toThrow("body_limit");
    expect(shadowBudgetMicroUsd("bad")).toBe(0);
    expect(shadowBudgetMicroUsd("Infinity")).toBe(0);
    expect(shadowBudgetMicroUsd("0")).toBe(0);
    expect(shadowWorkerOrigin("https://u:p@example.test/")).toBeNull();
    expect(shadowWorkerOrigin("https://example.test/path")).toBeNull();
    expect(() =>
      parseShadowInput(
        JSON.stringify({ ...packet, routingConfig: { apiKey: "private" } }),
      ),
    ).toThrow();
  });
});
