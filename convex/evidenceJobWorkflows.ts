import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const workflows = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 2 },
});
function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 1_000);
}

export const researchWorkflow = workflows
  .define({ args: { jobId: v.id("evidenceResearchJobs") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    await step.runMutation(internal.evidenceJobs.markResearchRunning, args);
    try {
      const result = await step.runAction(
        internal.evidenceJobActions.runResearch,
        args,
        { retry: true },
      );
      await step.runMutation(internal.evidenceJobs.completeResearchJob, {
        jobId: args.jobId,
        ...result,
      });
    } catch (error) {
      await step.runMutation(internal.evidenceJobs.failResearchJob, {
        jobId: args.jobId,
        errorMessage: errorMessage(error),
      });
    }
    return null;
  });
export const exportWorkflow = workflows
  .define({ args: { jobId: v.id("evidenceExportJobs") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    await step.runMutation(internal.evidenceJobs.markExportRunning, args);
    try {
      const result = await step.runAction(
        internal.evidenceJobActions.runExport,
        args,
        { retry: true },
      );
      await step.runMutation(internal.evidenceJobs.completeExportJob, {
        jobId: args.jobId,
        ...result,
      });
    } catch (error) {
      await step.runMutation(internal.evidenceJobs.failExportJob, {
        jobId: args.jobId,
        errorMessage: errorMessage(error),
      });
    }
    return null;
  });
export const startResearchWorkflow = internalAction({
  args: { jobId: v.id("evidenceResearchJobs") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> =>
    await workflows.start(
      ctx,
      internal.evidenceJobWorkflows.researchWorkflow,
      args,
      { startAsync: true },
    ),
});
export const startExportWorkflow = internalAction({
  args: { jobId: v.id("evidenceExportJobs") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> =>
    await workflows.start(
      ctx,
      internal.evidenceJobWorkflows.exportWorkflow,
      args,
      { startAsync: true },
    ),
});
