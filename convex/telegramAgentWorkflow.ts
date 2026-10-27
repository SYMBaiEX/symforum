import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";

export const telegramWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 1, retryActionsByDefault: false },
});

export const reply = telegramWorkflow.define({
  args: { requestId: v.id("telegramAgentRequests") },
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runAction(internal.telegramAgentReply.respond, args, {
      retry: false,
    });
    return null;
  },
});
