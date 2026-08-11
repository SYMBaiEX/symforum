import type { ModelRouteAttempt } from "../lib/ai-model-routing";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

export function routeTelemetry(
  ctx: ActionCtx,
  context: {
    correlationId: string;
    feature: string;
    runKey?: string;
    agentSlug?: string;
  },
) {
  return async (event: ModelRouteAttempt) => {
    await ctx.runMutation(internal.aiTelemetry.recordRouteEvent, {
      ...event,
      correlationId: context.correlationId,
      feature: context.feature,
      runKey: context.runKey,
      agentSlug: context.agentSlug,
    });
  };
}
