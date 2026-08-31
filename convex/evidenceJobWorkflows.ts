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
    const claim = await step.runMutation(
      internal.evidenceJobs.claimResearchExecution,
      args,
    );
    if (claim === null) return null;
    try {
      const result = await step.runAction(
        internal.evidenceJobActions.runResearch,
        { ...args, executionToken: claim.executionToken },
        { retry: false },
      );
      if (!result.started) return null;
      const { started: _started, ...completion } = result;
      await step.runMutation(internal.evidenceJobs.completeResearchJob, {
        jobId: args.jobId,
        executionToken: claim.executionToken,
        ...completion,
      });
    } catch (error) {
      await step.runMutation(internal.evidenceJobs.failResearchJob, {
        jobId: args.jobId,
        executionToken: claim.executionToken,
        errorMessage: errorMessage(error),
      });
    }
    return null;
  });
export const exportWorkflow = workflows
  .define({ args: { jobId: v.id("evidenceExportJobs") }, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    const claim = await step.runMutation(
      internal.evidenceJobs.claimExportExecution,
      args,
    );
    if (claim === null) return null;
    try {
      const result = await step.runAction(
        internal.evidenceJobActions.runExport,
        { ...args, executionToken: claim.executionToken },
        { retry: false },
      );
      if (!result.started) return null;
      const { started: _started, ...completion } = result;
      await step.runMutation(internal.evidenceJobs.completeExportJob, {
        jobId: args.jobId,
        executionToken: claim.executionToken,
        ...completion,
      });
    } catch (error) {
      await step.runMutation(internal.evidenceJobs.failExportJob, {
        jobId: args.jobId,
        executionToken: claim.executionToken,
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
