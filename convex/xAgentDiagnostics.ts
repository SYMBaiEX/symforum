"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, env } from "./_generated/server";
import { shadowWorkerOrigin } from "../lib/eliza-shadow-contract";

/** Verify the new read path using a freshly completed local receipt only.
 * Returns booleans, never result text, and cannot inspect a held operation. */
export const freshReceipt = internalAction({
  args: { agentSlug: v.string(), jobId: v.string() },
  returns: v.object({ httpStatus: v.number(), verified: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ httpStatus: number; verified: boolean }> => {
    const [call] = await ctx.runQuery(internal.elizaRuntimeData.inspect, args);
    const origin = shadowWorkerOrigin(env.ELIZA_RUNTIME_WORKER_URL);
    if (
      !call ||
      call.status !== "completed" ||
      call.outcomeUnknown ||
      Date.now() - call.createdAt > 120000 ||
      !origin ||
      !env.ELIZA_RUNTIME_WORKER_SECRET
    )
      return { httpStatus: 0, verified: false };
    try {
      const r = await fetch(new URL("/receipt", origin), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${env.ELIZA_RUNTIME_WORKER_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jobId: call.jobId,
          inputHash: call.inputHash,
          agentSlug: call.agentSlug,
          stage: call.stage,
        }),
      });
      if (!r.ok) {
        await r.body?.cancel();
        return { httpStatus: r.status, verified: false };
      }
      const raw = await r.text();
      if (raw.length > 256 * 1024)
        return { httpStatus: r.status, verified: false };
      const p = JSON.parse(raw);
      return {
        httpStatus: r.status,
        verified:
          p.version === 2 &&
          p.jobId === call.jobId &&
          p.inputHash === call.inputHash &&
          p.agentSlug === call.agentSlug &&
          p.stage === call.stage &&
          p.runtimeVersion === "1.7.2" &&
          p.completion?.usage?.prompt_tokens === call.inputTokens &&
          p.completion?.usage?.completion_tokens === call.outputTokens,
      };
    } catch {
      return { httpStatus: 0, verified: false };
    }
  },
});

/** Read-only worker metadata. Never fetch a completion, infer, refund or replay. */
export const status = internalAction({
  args: {
    agentSlug: v.string(),
    operationKey: v.optional(v.string()),
    jobId: v.optional(v.string()),
  },
  returns: v.object({
    httpStatus: v.number(),
    state: v.optional(v.string()),
    code: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    receipt: v.optional(
      v.object({
        idValid: v.optional(v.boolean()),
        choiceCountValid: v.optional(v.boolean()),
        finishReasonType: v.optional(v.string()),
        bindingValid: v.boolean(),
        servedModel: v.string(),
        objectValid: v.boolean(),
        createdValid: v.boolean(),
        choiceValid: v.boolean(),
        contentType: v.string(),
        toolCallsType: v.string(),
        usageValid: v.boolean(),
      }),
    ),
  }),
  handler: async (
    ctx,
    { agentSlug, operationKey, jobId },
  ): Promise<{
    httpStatus: number;
    state?: string;
    code?: string;
    errorCode?: string;
    receipt?: {
      idValid?: boolean;
      choiceCountValid?: boolean;
      finishReasonType?: string;
      bindingValid: boolean;
      servedModel: string;
      objectValid: boolean;
      createdValid: boolean;
      choiceValid: boolean;
      contentType: string;
      toolCallsType: string;
      usageValid: boolean;
    };
  }> => {
    const calls = await ctx.runQuery(internal.elizaRuntimeData.inspect, {
      agentSlug,
      limit: 40,
      jobId,
    });
    const call = calls.find(
      (c) =>
        (jobId ? c.jobId === jobId : c.outcomeUnknown) &&
        (!operationKey || c.operationKey === operationKey),
    );
    const origin = shadowWorkerOrigin(env.ELIZA_RUNTIME_WORKER_URL);
    if (!call) return { httpStatus: 0, code: "no_unknown_call" };
    if (!origin || !env.ELIZA_RUNTIME_WORKER_SECRET)
      return { httpStatus: 0, code: "runtime_unavailable" };
    try {
      const r = await fetch(new URL("/status", origin), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.ELIZA_RUNTIME_WORKER_SECRET}`,
        },
        body: JSON.stringify({ jobId: call.jobId }),
      });
      const text = await r.text();
      if (text.length > 8192)
        return { httpStatus: r.status, code: "oversized_response" };
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { httpStatus: r.status, code: "non_json_response" };
      }
      const code = (value: unknown) =>
        typeof value === "string" && /^[a-z0-9_]{1,80}$/.test(value)
          ? value
          : undefined;
      const raw = p.receiptDiagnostics;
      const d =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : undefined;
      const receipt =
        d &&
        [
          "bindingValid",
          "objectValid",
          "createdValid",
          "choiceValid",
          "usageValid",
        ].every((k) => typeof d[k] === "boolean") &&
        typeof d.servedModel === "string" &&
        /^(?:openai\/gpt-6-luna(?:-[0-9]{8})?|openrouter\/free|deepseek\/deepseek-v4-flash(?:-[a-z0-9-]{1,40})?|invalid)$/.test(
          d.servedModel,
        ) &&
        [d.contentType, d.toolCallsType].every(
          (t) =>
            typeof t === "string" &&
            ["string", "null", "array", "absent", "invalid"].includes(t),
        )
          ? {
              idValid: typeof d.idValid === "boolean" ? d.idValid : undefined,
              choiceCountValid:
                typeof d.choiceCountValid === "boolean"
                  ? d.choiceCountValid
                  : undefined,
              finishReasonType: [
                "string",
                "null",
                "absent",
                "invalid",
              ].includes(String(d.finishReasonType))
                ? String(d.finishReasonType)
                : undefined,
              bindingValid: d.bindingValid as boolean,
              servedModel: d.servedModel,
              objectValid: d.objectValid as boolean,
              createdValid: d.createdValid as boolean,
              choiceValid: d.choiceValid as boolean,
              contentType: d.contentType as string,
              toolCallsType: d.toolCallsType as string,
              usageValid: d.usageValid as boolean,
            }
          : undefined;
      return {
        receipt,
        httpStatus: r.status,
        state: code(p.state),
        code: code(p.error),
        errorCode: code(p.errorCode),
      };
    } catch {
      return { httpStatus: 0, code: "metadata_request_failed" };
    }
  },
});
