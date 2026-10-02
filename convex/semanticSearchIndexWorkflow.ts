import { WorkflowManager, type WorkflowCtx } from "@convex-dev/workflow";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { semanticSearchConfig } from "../lib/semantic-search-config";
import { components, internal } from "./_generated/api";
import { env, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const workflows = new WorkflowManager(components.workflow, {
  // Index updates are low-priority maintenance. Serializing them coalesces
  // naturally through the action's fingerprint idempotence and prevents
  // ingestion bursts from creating an unbounded embedding concurrency spike.
  workpoolOptions: { maxParallelism: 1, retryActionsByDefault: false },
});

const indexWorkflowRef = makeFunctionReference<
  "mutation",
  { documentId: Id<"evidenceDocuments"> },
  null
>(
  "semanticSearchIndexWorkflow.indexPublicEvidenceWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { documentId: Id<"evidenceDocuments"> },
  null
>;

const indexDocumentArgs = {
  documentId: v.id("evidenceDocuments"),
  allowPriorSourceRevision: v.optional(v.boolean()),
};
const sourceIndexArgs = { sourceId: v.id("evidenceSources") };
const DAILY_BUDGET_RETRY_MS = 24 * 60 * 60 * 1_000;
const CIRCUIT_RETRY_MS = 15 * 60 * 1_000;
const MAX_CIRCUIT_RETRIES = 4;
const sourceBackfillPageRef = makeFunctionReference<
  "query",
  {
    sourceId: Id<"evidenceSources">;
    cursor?: string;
  },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>(
  "semanticSearch:readPublicSourceBackfillPage",
) as unknown as FunctionReference<
  "query",
  "internal",
  {
    sourceId: Id<"evidenceSources">;
    cursor?: string;
  },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>;
const sourceIndexWorkflowRef = makeFunctionReference<
  "mutation",
  { sourceId: Id<"evidenceSources"> },
  null
>(
  "semanticSearchIndexWorkflow.indexPublicEvidenceSourceWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { sourceId: Id<"evidenceSources"> },
  null
>;
const removeDocumentWorkflowRef = makeFunctionReference<
  "mutation",
  { documentId: Id<"evidenceDocuments"> },
  null
>(
  "semanticSearchIndexWorkflow.removeNonPublicEvidenceDocumentWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { documentId: Id<"evidenceDocuments"> },
  null
>;
const removeSourceWorkflowRef = makeFunctionReference<
  "mutation",
  { sourceId: Id<"evidenceSources"> },
  null
>(
  "semanticSearchIndexWorkflow.removeNonPublicEvidenceSourceWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { sourceId: Id<"evidenceSources"> },
  null
>;
const cleanupStaleVectorsWorkflowRef = makeFunctionReference<
  "mutation",
  { cleanupVersion: 1 },
  null
>(
  "semanticSearchIndexWorkflow.cleanupStalePublicEvidenceVectorsWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { cleanupVersion: 1 },
  null
>;
const removeDocumentsRef = makeFunctionReference<
  "action",
  { documentIds: Id<"evidenceDocuments">[] },
  { attempted: number; skipped: number }
>(
  "semanticSearch:removeNonPublicEvidenceDocuments",
) as unknown as FunctionReference<
  "action",
  "internal",
  { documentIds: Id<"evidenceDocuments">[] },
  { attempted: number; skipped: number }
>;
const cleanupSourcePageRef = makeFunctionReference<
  "query",
  { sourceId: Id<"evidenceSources">; cursor?: string },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>(
  "semanticSearch:readNonPublicSourceVectorCleanupPage",
) as unknown as FunctionReference<
  "query",
  "internal",
  { sourceId: Id<"evidenceSources">; cursor?: string },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>;
const cleanupStalePageRef = makeFunctionReference<
  "query",
  { cursor?: string },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>(
  "semanticSearch:readStalePublicEvidenceVectorCleanupPage",
) as unknown as FunctionReference<
  "query",
  "internal",
  { cursor?: string },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
>;
const hasIndexNamespaceRef = makeFunctionReference<
  "action",
  Record<string, never>,
  boolean
>(
  "semanticSearch:hasPublicEvidenceIndexNamespace",
) as unknown as FunctionReference<
  "action",
  "internal",
  Record<string, never>,
  boolean
>;
const CLEANUP_RETRY = { maxAttempts: 4, initialBackoffMs: 1_000, base: 2 };

type IndexDocumentArgs = {
  documentId: Id<"evidenceDocuments">;
  allowPriorSourceRevision?: boolean;
};

/** Retry only skips that are known to be temporary and incurred no provider call. */
async function indexWithTransientRetries(
  step: WorkflowCtx,
  args: IndexDocumentArgs,
) {
  let result = await step.runAction(
    internal.semanticSearch.indexPublicEvidenceDocument,
    args,
    { retry: false },
  );

  if (result.reason === "budget") {
    // The atomic reservation rejected before embedding. Recheck once after a
    // new daily window instead of silently treating this document as complete.
    await step.sleep(DAILY_BUDGET_RETRY_MS);
    result = await step.runAction(
      internal.semanticSearch.indexPublicEvidenceDocument,
      args,
      { retry: false },
    );
  }

  let circuitRetries = 0;
  while (
    result.reason === "circuit_paused" &&
    circuitRetries < MAX_CIRCUIT_RETRIES
  ) {
    circuitRetries += 1;
    await step.sleep(CIRCUIT_RETRY_MS);
    result = await step.runAction(
      internal.semanticSearch.indexPublicEvidenceDocument,
      args,
      { retry: false },
    );
  }

  return result;
}

export const indexPublicEvidenceWorkflow = workflows
  .define({ args: indexDocumentArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    await indexWithTransientRetries(step, args);
    return null;
  });

/** Re-index only one newly public/active source; page reads stay bounded. */
export const indexPublicEvidenceSourceWorkflow = workflows
  .define({ args: sourceIndexArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    let cursor: string | undefined;
    while (true) {
      const page = await step.runQuery(sourceBackfillPageRef, {
        sourceId: args.sourceId,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const documentId of page.documentIds) {
        const result = await indexWithTransientRetries(step, {
          documentId,
          allowPriorSourceRevision: true,
        });
        if (result.reason === "budget" || result.reason === "circuit_paused") {
          return null;
        }
        // This particular document cannot fit the configured daily cap; it
        // will not become indexable by retrying. Do not block later documents.
        if (result.reason === "request_exceeds_budget") continue;
      }
      if (page.done || page.continueCursor === undefined) return null;
      cursor = page.continueCursor;
    }
  });

/** Delete a document's vector entry only if it is still outside the public corpus. */
export const removeNonPublicEvidenceDocumentWorkflow = workflows
  .define({
    args: { documentId: v.id("evidenceDocuments") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    await step.runAction(
      removeDocumentsRef,
      { documentIds: [args.documentId] },
      { retry: CLEANUP_RETRY },
    );
    return null;
  });

/** Remove all now-ineligible document vectors for one source, with bounded pages. */
export const removeNonPublicEvidenceSourceWorkflow = workflows
  .define({ args: sourceIndexArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    if (!(await step.runAction(hasIndexNamespaceRef, {}, { retry: false })))
      return null;
    let cursor: string | undefined;
    while (true) {
      const page = await step.runQuery(cleanupSourcePageRef, {
        sourceId: args.sourceId,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (page.documentIds.length > 0) {
        await step.runAction(
          removeDocumentsRef,
          { documentIds: page.documentIds },
          { retry: CLEANUP_RETRY },
        );
      }
      if (page.done || page.continueCursor === undefined) return null;
      cursor = page.continueCursor;
    }
  });

/** One-time bounded reconciliation for vectors made private before the cleanup hooks existed. */
export const cleanupStalePublicEvidenceVectorsWorkflow = workflows
  .define({ args: { cleanupVersion: v.literal(1) }, returns: v.null() })
  .handler(async (step): Promise<null> => {
    if (!(await step.runAction(hasIndexNamespaceRef, {}, { retry: false })))
      return null;
    let cursor: string | undefined;
    while (true) {
      const page = await step.runQuery(cleanupStalePageRef, {
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (page.documentIds.length > 0) {
        await step.runAction(
          removeDocumentsRef,
          { documentIds: page.documentIds },
          { retry: CLEANUP_RETRY },
        );
      }
      if (page.done || page.continueCursor === undefined) return null;
      cursor = page.continueCursor;
    }
  });

/** Operator entry point for the one-time stale-vector reconciliation. */
export const startStalePublicEvidenceVectorCleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await workflows.start(
      ctx,
      cleanupStaleVectorsWorkflowRef,
      { cleanupVersion: 1 },
      { startAsync: true },
    );
    return null;
  },
});

/** Queue one idempotent index attempt only when the fully validated feature is usable. */
export async function enqueuePublicEvidenceIndex(
  ctx: MutationCtx,
  documentId: Id<"evidenceDocuments">,
): Promise<boolean> {
  const values = env as unknown as Record<string, string | undefined>;
  const settings = semanticSearchConfig({
    enabled: values.SEMANTIC_SEARCH_ENABLED,
    dailyBudgetUsd: values.SEMANTIC_SEARCH_DAILY_BUDGET_USD,
    embeddingModel: values.SEMANTIC_SEARCH_EMBEDDING_MODEL,
  });
  if (
    values.SEMANTIC_SEARCH_AUTO_INDEX_ENABLED?.trim().toLowerCase() !==
      "true" ||
    !settings.enabled ||
    !env.OPENROUTER_API_KEY?.trim()
  ) {
    return false;
  }

  await workflows.start(
    ctx,
    indexWorkflowRef,
    { documentId },
    { startAsync: true },
  );
  return true;
}

/** Queue source-scoped catch-up work after a source becomes publicly searchable. */
export async function enqueuePublicEvidenceSourceIndex(
  ctx: MutationCtx,
  sourceId: Id<"evidenceSources">,
): Promise<boolean> {
  const values = env as unknown as Record<string, string | undefined>;
  const settings = semanticSearchConfig({
    enabled: values.SEMANTIC_SEARCH_ENABLED,
    dailyBudgetUsd: values.SEMANTIC_SEARCH_DAILY_BUDGET_USD,
    embeddingModel: values.SEMANTIC_SEARCH_EMBEDDING_MODEL,
  });
  if (
    values.SEMANTIC_SEARCH_AUTO_INDEX_ENABLED?.trim().toLowerCase() !==
      "true" ||
    !settings.enabled ||
    !env.OPENROUTER_API_KEY?.trim()
  ) {
    return false;
  }

  await workflows.start(
    ctx,
    sourceIndexWorkflowRef,
    { sourceId },
    { startAsync: true },
  );
  return true;
}

/** Queue removal after a document loses public visibility. */
export async function enqueueNonPublicEvidenceDocumentCleanup(
  ctx: MutationCtx,
  documentId: Id<"evidenceDocuments">,
): Promise<void> {
  await workflows.start(
    ctx,
    removeDocumentWorkflowRef,
    { documentId },
    { startAsync: true },
  );
}

/** Queue source-scoped vector removal after a source leaves the public corpus. */
export async function enqueueNonPublicEvidenceSourceCleanup(
  ctx: MutationCtx,
  sourceId: Id<"evidenceSources">,
): Promise<void> {
  await workflows.start(
    ctx,
    removeSourceWorkflowRef,
    { sourceId },
    { startAsync: true },
  );
}
