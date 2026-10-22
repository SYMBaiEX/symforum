// @vitest-environment node
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { validateBelle } from "./elizaPilotValidation";
import type { ActionCtx } from "./_generated/server";

type PilotArgs = {
  nonce: string;
  runDate: string;
  snapshotDate: string;
  useElizaRuntime?: boolean;
};
const handler = (
  validateBelle as unknown as {
    _handler(
      ctx: ActionCtx,
      args: PilotArgs,
    ): Promise<{
      duplicate: boolean;
      run: {
        status: string;
        errorCode?: string;
        shadowStatus?: string;
        baselineDecision?: string;
        sourceCount?: number;
      };
    }>;
  }
)._handler;

function context(options: {
  artifactStatus?: "accepted" | "rejected" | "review_failed" | null;
  error?: Error;
  shadowStatus?: "limited" | "disabled" | "unavailable" | "duplicate";
}) {
  const runQuery = vi.fn(async (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "news:readIndexedSnapshot":
        return {
          snapshot: { snapshotDate: "2026-10-20", status: "complete" },
          stories: Array.from({ length: 18 }, (_, index) => ({
            hnItemId: index + 1,
            rank: index + 1,
            title: `Real source ${index + 1}`,
          })),
        };
      case "elizaPilotValidationData:readArtifactStatus":
        return options.artifactStatus ?? null;
      default:
        throw new Error("unexpected_query");
    }
  });
  const runMutation = vi.fn(
    async (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) =>
      getFunctionName(ref) === "elizaPilotValidationData:reserve"
        ? { duplicate: false, run: { ...args, status: "reserved" } }
        : {
            ...args,
            kind: "belle-newsletter",
            sourceKey: "snapshot:2026-10-20",
          },
  );
  const runAction = vi.fn(async () => {
    if (options.error) throw options.error;
    return {
      subject: "A bounded real-source pilot",
      storyCount: 3,
      topStoryIds: [1, 2, 3],
      shadowEnqueue: { status: options.shadowStatus ?? "limited" },
    };
  });
  return {
    ctx: { runQuery, runMutation, runAction } as unknown as ActionCtx,
    runQuery,
    runMutation,
    runAction,
  };
}
const args = {
  nonce: "cutover_belle_artifact_001",
  runDate: "2026-10-21",
  snapshotDate: "2026-10-20",
};

describe("forced ElizaOS pilot evidence versus comparison quota", () => {
  test("accepted retained forced generation can finish with comparison honestly limited", async () => {
    const { ctx, runAction } = context({ artifactStatus: "accepted" });
    const result = await handler(ctx, { ...args, useElizaRuntime: true });
    expect(result.run).toMatchObject({
      status: "completed",
      baselineDecision: "accepted",
      shadowStatus: "limited",
      sourceCount: 18,
    });
    expect(runAction).toHaveBeenCalledTimes(1);
  });

  test.each([null, "rejected", "review_failed"] as const)(
    "missing, expired or nonaccepted artifact cannot pass (%s)",
    async (artifactStatus) => {
      const { ctx } = context({ artifactStatus });
      expect(
        (await handler(ctx, { ...args, useElizaRuntime: true })).run,
      ).toMatchObject({ status: "blocked", errorCode: "shadow_limited" });
    },
  );

  test.each(["disabled", "unavailable", "duplicate"] as const)(
    "accepted artifact cannot hide a non-quota comparison problem (%s)",
    async (shadowStatus) => {
      const { ctx, runQuery } = context({
        artifactStatus: "accepted",
        shadowStatus,
      });
      expect(
        (await handler(ctx, { ...args, useElizaRuntime: true })).run,
      ).toMatchObject({
        status: "blocked",
        errorCode: `shadow_${shadowStatus}`,
      });
      expect(runQuery).toHaveBeenCalledTimes(1);
    },
  );

  test("legacy generation still requires the actual ElizaOS comparison", async () => {
    const { ctx, runQuery } = context({ artifactStatus: "accepted" });
    expect((await handler(ctx, args)).run).toMatchObject({
      status: "blocked",
      errorCode: "shadow_limited",
    });
    expect(
      runQuery.mock.calls.some(
        ([ref]) =>
          getFunctionName(ref) ===
          "elizaPilotValidationData:readArtifactStatus",
      ),
    ).toBe(false);
  });

  test.each(["baseline_quality_rejected", "baseline_review_failed"])(
    "retaining a failed artifact never converts it to acceptance (%s)",
    async (code) => {
      const { ctx, runQuery } = context({
        error: new ConvexError({
          code,
          artifactRetained: true,
          shadowStatus: "limited",
        }),
      });
      expect(
        (await handler(ctx, { ...args, useElizaRuntime: true })).run,
      ).toMatchObject({
        status: "failed",
        errorCode: code,
        shadowStatus: "limited",
        sourceCount: 18,
      });
      expect(runQuery).toHaveBeenCalledTimes(1);
    },
  );

  test("unknown runtime failure remains failed without an accepted-artifact lookup", async () => {
    const { ctx, runQuery } = context({
      artifactStatus: "accepted",
      error: new Error("eliza_runtime_operation_unresolved"),
    });
    expect(
      (await handler(ctx, { ...args, useElizaRuntime: true })).run,
    ).toMatchObject({
      status: "failed",
      errorCode: "baseline_or_source_failed",
    });
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});
