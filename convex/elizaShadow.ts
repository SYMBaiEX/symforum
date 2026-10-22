import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";
import {
  ELIZA_SHADOW_TIMEOUT_MS,
  ELIZA_SHADOW_OUTPUT_MAX_BYTES,
  parseBoundedShadowJson,
  parseShadowInput,
  shadowWorkerOrigin,
  shadowWorkerResultSchema,
} from "../lib/eliza-shadow-contract";

/** Convex calls a generation-only worker. No worker endpoint can publish or send. */
export const dispatch = internalAction({
  args: { jobId: v.id("elizaShadowJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runMutation(internal.elizaShadowData.claim, {
      jobId,
    });
    if (!job) return null;
    let errorCode:
      | "worker_unavailable"
      | "invalid_worker_result"
      | "evaluation_unavailable" = "worker_unavailable";
    try {
      const origin = shadowWorkerOrigin(env.ELIZA_SHADOW_WORKER_URL);
      const secret = env.ELIZA_SHADOW_WORKER_SECRET;
      if (
        !origin ||
        !secret ||
        secret.length < 32 ||
        (env.ELIZA_SHADOW_MODE !== "shadow" &&
          !(env.ELIZA_SHADOW_MODE === "canary" && job.isCanary === true))
      )
        throw new Error("disabled");
      const input = parseShadowInput(job.inputJson);
      const signal = AbortSignal.timeout(ELIZA_SHADOW_TIMEOUT_MS);
      const response = await fetch(`${origin}/generate`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          ...input,
          jobId,
          inputHash: job.inputHash,
          model: job.model,
          maxOutputTokens: job.maxOutputTokens,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("worker_unavailable");
      }
      errorCode = "invalid_worker_result";
      const resultJson = await readBoundedResponse(
        response,
        ELIZA_SHADOW_OUTPUT_MAX_BYTES + 2_048,
      );
      const result = shadowWorkerResultSchema.parse(
        parseBoundedShadowJson(
          resultJson,
          ELIZA_SHADOW_OUTPUT_MAX_BYTES + 2_048,
        ),
      );
      if (
        result.jobId !== jobId ||
        result.inputHash !== job.inputHash ||
        result.model !== job.model ||
        result.outputTokens > job.maxOutputTokens
      )
        throw new Error("worker_mismatch");
      const context = await ctx.runQuery(
        internal.elizaShadowData.evaluationContext,
        { jobId },
      );
      if (!context) throw new Error("expired");
      errorCode = "evaluation_unavailable";
      const comparisonJson: string = context.isCanary
        ? JSON.stringify({
            evaluatorVersion: "shadow-canary-v1",
            healthy:
              result.output.healthy === true && result.output.mode === "shadow",
            publicationAllowed: false,
          })
        : await ctx.runAction(internal.elizaShadowEvaluation.evaluate, {
            ...contextForEvaluation(context),
            outputJson: JSON.stringify(result.output),
          });
      await ctx.runMutation(internal.elizaShadowData.complete, {
        jobId,
        resultJson,
        comparisonJson,
      });
    } catch {
      // Never persist provider exception text; it can contain source copy or credentials.
      await ctx.runMutation(internal.elizaShadowData.fail, {
        jobId,
        errorCode,
      });
    }
    return null;
  },
});

/** Retention remains scheduled by Convex, even while generation is disabled. */
export const maintain = internalAction({
  args: {},
  returns: v.boolean(),
  handler: async () => {
    const origin = shadowWorkerOrigin(env.ELIZA_SHADOW_WORKER_URL);
    const secret = env.ELIZA_SHADOW_WORKER_SECRET;
    if (!origin || !secret || secret.length < 32) return false;
    try {
      const response = await fetch(`${origin}/maintenance`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: "{}",
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      console.warn("eliza_shadow_retention_unavailable");
      return false;
    }
  },
});

function contextForEvaluation(context: {
  kind: "suki-reply" | "belle-newsletter";
  inputJson: string;
  baselineJson: string;
  evaluationJson: string;
}) {
  return {
    kind: context.kind,
    inputJson: context.inputJson,
    baselineJson: context.baselineJson,
    evaluationJson: context.evaluationJson,
  };
}

export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
) {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("worker_body_limit");
  if (!response.body) throw new Error("worker_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("worker_body_limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}
