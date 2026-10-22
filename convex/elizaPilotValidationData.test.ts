// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const reserve = makeFunctionReference<
  "mutation",
  {
    nonce: string;
    kind: "suki-reply" | "belle-newsletter";
    sourceKey: string;
  },
  unknown
>("elizaPilotValidationData:reserve");
const finish = makeFunctionReference<
  "mutation",
  {
    nonce: string;
    status: "completed" | "blocked" | "failed";
  },
  unknown
>("elizaPilotValidationData:finish");
const recordArtifact = makeFunctionReference<
  "mutation",
  {
    nonce: string;
    sourceKey: string;
    baselineJson: string;
    evaluationJson: string;
    artifactStatus: "accepted" | "rejected" | "review_failed";
  },
  {
    artifactHash: string;
    artifactExpiresAt: number;
    artifactStatus: "accepted" | "rejected" | "review_failed";
    duplicate: boolean;
  }
>("elizaPilotValidationData:recordArtifact");
const inspectBaseline = makeFunctionReference<
  "query",
  { nonce: string },
  {
    nonce: string;
    baselineJson: string;
    evaluationJson: string;
    artifactStatus: "accepted" | "rejected" | "review_failed";
    artifactExpiresAt: number;
    artifactHash: string;
  } | null
>("elizaPilotValidationData:inspectBaseline");
const readArtifactStatus = makeFunctionReference<
  "query",
  { nonce: string },
  "accepted" | "rejected" | "review_failed" | null
>("elizaPilotValidationData:readArtifactStatus");
const cleanupArtifacts = makeFunctionReference<
  "mutation",
  Record<string, never>,
  number
>("elizaPilotValidationData:cleanupArtifacts");

const baselineJson = JSON.stringify({ baseline: "private text" });
const evaluationJson = JSON.stringify({ score: 99, issues: ["private issue"] });
const pilot = "pilot_belle_artifact_0001";
const pilotSourceKey = "snapshot:2026-10-20:run:2026-10-21";

function setup() {
  return convexTest(schema, modules);
}

async function reserveBelle(
  t: ReturnType<typeof setup>,
  nonce = pilot,
  sourceKey = pilotSourceKey,
) {
  await t.mutation(reserve, {
    nonce,
    kind: "belle-newsletter",
    sourceKey,
  });
}

afterEach(() => vi.useRealTimers());

describe("private Belle pilot artifacts", () => {
  test("records one immutable bounded artifact and allows only exact retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
    const t = setup();
    await reserveBelle(t);
    const artifact = {
      nonce: pilot,
      sourceKey: pilotSourceKey,
      baselineJson,
      evaluationJson,
      artifactStatus: "rejected" as const,
    };

    const first = await t.mutation(recordArtifact, artifact);
    expect(first.duplicate).toBe(false);
    expect(first.artifactExpiresAt).toBe(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    expect(first.artifactHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(t.mutation(recordArtifact, artifact)).resolves.toEqual({
      ...first,
      duplicate: true,
    });
    await expect(
      t.mutation(recordArtifact, { ...artifact, evaluationJson: "{}" }),
    ).rejects.toThrow("pilot_artifact_conflict");
    await expect(t.query(inspectBaseline, { nonce: pilot })).resolves.toEqual({
      nonce: pilot,
      baselineJson,
      evaluationJson,
      artifactStatus: "rejected",
      artifactExpiresAt: first.artifactExpiresAt,
      artifactHash: first.artifactHash,
    });
    await expect(t.query(readArtifactStatus, { nonce: pilot })).resolves.toBe(
      "rejected",
    );
  });

  test("binds artifact writes to the exact reserved snapshot, run, and transport", async () => {
    const t = setup();
    await reserveBelle(t);
    for (const sourceKey of [
      "snapshot:2026-10-19:run:2026-10-21",
      "snapshot:2026-10-20:run:2026-10-22",
      `${pilotSourceKey}:eliza`,
      "snapshot:2026-10-19:run:2026-10-22:eliza",
    ]) {
      await expect(
        t.mutation(recordArtifact, {
          nonce: pilot,
          sourceKey,
          baselineJson,
          evaluationJson,
          artifactStatus: "rejected",
        }),
      ).rejects.toThrow("pilot_artifact_source_mismatch");
    }
    await expect(
      t.query(inspectBaseline, { nonce: pilot }),
    ).resolves.toBeNull();

    const compatibleNonce = "pilot_belle_eliza_artifact_01";
    const elizaSourceKey = `${pilotSourceKey}:eliza`;
    await reserveBelle(t, compatibleNonce, elizaSourceKey);
    await expect(
      t.mutation(recordArtifact, {
        nonce: compatibleNonce,
        sourceKey: elizaSourceKey,
        baselineJson,
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).resolves.toMatchObject({ duplicate: false, artifactStatus: "accepted" });
  });

  test("requires a reserved Belle run and valid, individually bounded JSON", async () => {
    const t = setup();
    await t.mutation(reserve, {
      nonce: "pilot_suki_artifact_0001",
      kind: "suki-reply",
      sourceKey: "thread:one",
    });
    await expect(
      t.mutation(recordArtifact, {
        nonce: "pilot_suki_artifact_0001",
        sourceKey: "thread:one",
        baselineJson,
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow("pilot_artifact_source_invalid");

    await reserveBelle(t);
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: "snapshot:2026-10-20:run:2026-10-21:unexpected",
        baselineJson,
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow("pilot_artifact_source_invalid");
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: "x".repeat(161),
        baselineJson,
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow("pilot_artifact_source_invalid");
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: pilotSourceKey,
        baselineJson: "not JSON",
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: pilotSourceKey,
        baselineJson,
        evaluationJson: JSON.stringify("x".repeat(160 * 1024)),
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow("shadow_payload_too_large");
    await expect(
      t.query(inspectBaseline, { nonce: pilot }),
    ).resolves.toBeNull();
  });

  test("rejects writes after finish and expires private payloads to a nonce/status tombstone", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-10-21T12:00:00.000Z");
    vi.setSystemTime(startedAt);
    const t = setup();
    await reserveBelle(t);
    await t.mutation(recordArtifact, {
      nonce: pilot,
      sourceKey: pilotSourceKey,
      baselineJson,
      evaluationJson,
      artifactStatus: "review_failed",
    });
    await t.mutation(finish, { nonce: pilot, status: "completed" });
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: pilotSourceKey,
        baselineJson,
        evaluationJson,
        artifactStatus: "review_failed",
      }),
    ).rejects.toThrow("pilot_artifact_attempt_closed");

    vi.setSystemTime(startedAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
    await expect(
      t.query(inspectBaseline, { nonce: pilot }),
    ).resolves.toBeNull();
    await expect(
      t.query(readArtifactStatus, { nonce: pilot }),
    ).resolves.toBeNull();
    await expect(t.mutation(cleanupArtifacts, {})).resolves.toBe(1);
    const row = await t.run((ctx) =>
      ctx.db
        .query("elizaPilotRuns")
        .withIndex("by_nonce", (q) => q.eq("nonce", pilot))
        .unique(),
    );
    expect(row).toMatchObject({ nonce: pilot, status: "completed" });
    expect(row).not.toHaveProperty("baselineJson");
    expect(row).not.toHaveProperty("evaluationJson");
    expect(row).not.toHaveProperty("artifactStatus");
    expect(row).not.toHaveProperty("artifactExpiresAt");
    expect(row).not.toHaveProperty("artifactHash");
  });

  test("closed reserved attempts without an artifact cannot acquire one later", async () => {
    const t = setup();
    await reserveBelle(t);
    await t.mutation(finish, { nonce: pilot, status: "failed" });
    await expect(
      t.mutation(recordArtifact, {
        nonce: pilot,
        sourceKey: pilotSourceKey,
        baselineJson,
        evaluationJson,
        artifactStatus: "accepted",
      }),
    ).rejects.toThrow("pilot_artifact_attempt_closed");
  });

  test("cleanup skips legacy rows without expiry and does not update timestamps", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-10-21T12:00:00.000Z");
    vi.setSystemTime(startedAt);
    const t = setup();
    const legacyNonces = Array.from(
      { length: 50 },
      (_, index) => `pilot_legacy_${String(index).padStart(3, "0")}_0001`,
    );
    await t.run(async (ctx) => {
      for (const nonce of legacyNonces) {
        await ctx.db.insert("elizaPilotRuns", {
          nonce,
          kind: "belle-newsletter",
          sourceKey: "snapshot:legacy",
          status: "completed",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
    await reserveBelle(t);
    const artifact = await t.mutation(recordArtifact, {
      nonce: pilot,
      sourceKey: pilotSourceKey,
      baselineJson,
      evaluationJson,
      artifactStatus: "rejected",
    });
    vi.setSystemTime(startedAt.getTime() + 1_000);
    await t.mutation(finish, { nonce: pilot, status: "completed" });
    const beforeCleanup = await t.run(async (ctx) => ({
      artifact: await ctx.db
        .query("elizaPilotRuns")
        .withIndex("by_nonce", (q) => q.eq("nonce", pilot))
        .unique(),
      legacy: await ctx.db
        .query("elizaPilotRuns")
        .withIndex("by_nonce", (q) => q.eq("nonce", legacyNonces[0]))
        .unique(),
    }));

    vi.setSystemTime(artifact.artifactExpiresAt);
    await expect(t.mutation(cleanupArtifacts, {})).resolves.toBe(1);
    await expect(t.mutation(cleanupArtifacts, {})).resolves.toBe(0);
    const afterCleanup = await t.run(async (ctx) => ({
      artifact: await ctx.db
        .query("elizaPilotRuns")
        .withIndex("by_nonce", (q) => q.eq("nonce", pilot))
        .unique(),
      legacy: await ctx.db
        .query("elizaPilotRuns")
        .withIndex("by_nonce", (q) => q.eq("nonce", legacyNonces[0]))
        .unique(),
    }));
    expect(afterCleanup.artifact).toMatchObject({
      nonce: pilot,
      status: "completed",
      createdAt: beforeCleanup.artifact?.createdAt,
      updatedAt: beforeCleanup.artifact?.updatedAt,
    });
    expect(afterCleanup.artifact).not.toHaveProperty("baselineJson");
    expect(afterCleanup.legacy).toEqual(beforeCleanup.legacy);
  });
});
