"use node";

import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { convexModelRoutingConfig } from "./modelRouting";
import {
  buildEvidenceDatasetManifest,
  EVIDENCE_EXPORT_SCHEMA_VERSION,
} from "../lib/evidence-dataset-manifest";
import { serializeEvidenceExport } from "../lib/evidence-export-format";
import {
  runWithModelFallback,
  type RoutedModel,
} from "../lib/ai-model-routing";
import { estimatePromptInputTokens } from "../lib/ai-model-costs";
import {
  buildEvidenceResearchPrompt,
  buildExtractiveEvidenceDigest,
  compactEvidenceResearchSources,
  hasGroundedEvidenceResearchCitations,
} from "../lib/evidence-research-prompt";

const MAX_SOURCES = 10;
// Production Insights showed repeated ~17 MB reads in this export query,
// close to the 16 MiB transaction ceiling. Keep ordinary per-query fan-out
// conservative; system snapshots use a smaller page because they enrich each
// selected document with its related evidence graph.
const EXPORT_QUERY_PAGE_SIZE = 25;
const DATASET_SNAPSHOT_QUERY_PAGE_SIZE = 10;
const DATASET_SNAPSHOT_RECORD_LIMIT = 100;
type Source = {
  documentId: string;
  currentVersionId: string | null;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  kind: string;
  updatedAt: number;
};
type ExportRecord = {
  schemaVersion: string;
  datasetKey: string;
  documentId: string;
  versionId: string | null;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  kind: string;
  licenseClass: string;
  tags: string[];
  authors: string[];
  publishedAt: number | null;
  firstSeenAt: number;
  updatedAt: number;
  source: {
    sourceKey: string;
    name: string;
    homepageUrl: string;
    termsUrl: string;
    provenanceClass: string;
    licenseClass: string;
  };
  version: null | {
    version: number;
    contentHash: string;
    fetchedAt: number;
    sourceRevision: string;
    sourceUpdatedAt: number;
    retrievalUrl: string;
    metadataJson: string;
  };
  citationMetrics: {
    total: number;
    supports: number;
    contradicts: number;
    context: number;
    truncated: boolean;
  };
  entities: Array<{
    entityKey: string;
    kind: string;
    name: string;
    aliases: string[];
    role: string;
  }>;
  claims: Array<{
    claimKey: string;
    statement: string;
    predicate: string;
    objectText: string;
    status: string;
    confidence: number;
    observedAt: number;
    relation: string;
    locator: string;
    excerpt: string;
  }>;
};
type ExportBundle = {
  publicationEpoch: number;
  dataset: {
    datasetKey: string;
    name: string;
    description: string;
    includedKinds: string[];
    includedLicenseClasses: string[];
    sourceKeys: string[];
    exportSchemaVersion: string;
  };
  scannedRecordCount: number;
  selectionScanTruncated: boolean;
  selectionStrategy: "balanced" | "recent";
  snapshotAt: number;
  continueCursor?: string;
  records: ExportRecord[];
};

async function readExportPages(
  ctx: ActionCtx,
  args: {
    datasetId: Id<"evidenceDatasets">;
    recordLimit: number;
    queryPageSize: number;
    selectionStrategy: "balanced" | "recent";
    cursor?: string;
  },
): Promise<ExportBundle> {
  const pageCount = Math.ceil(args.recordLimit / args.queryPageSize);
  const records: ExportRecord[] = [];
  let scannedRecordCount = 0;
  let cursor = args.cursor;
  let firstPage: ExportBundle | undefined;
  let lastPage: ExportBundle | undefined;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const remainingScanBudget = args.recordLimit - scannedRecordCount;
    if (remainingScanBudget <= 0) break;
    const page: ExportBundle = await ctx.runQuery(refs.exportDocuments, {
      datasetId: args.datasetId,
      limit: Math.min(args.queryPageSize, remainingScanBudget),
      selectionStrategy: args.selectionStrategy,
      cursor,
    });
    if (firstPage === undefined) {
      firstPage = page;
    } else if (
      page.publicationEpoch !== firstPage.publicationEpoch ||
      page.snapshotAt !== firstPage.snapshotAt ||
      page.selectionStrategy !== firstPage.selectionStrategy ||
      JSON.stringify(page.dataset) !== JSON.stringify(firstPage.dataset)
    ) {
      throw new Error(
        "Evidence dataset changed while its export pages were being read. Retry with a fresh export job.",
      );
    }
    records.push(...page.records);
    scannedRecordCount += page.scannedRecordCount;
    lastPage = page;
    if (
      records.length >= args.recordLimit ||
      scannedRecordCount >= args.recordLimit ||
      page.continueCursor === undefined
    )
      break;
    cursor = page.continueCursor;
  }

  if (firstPage === undefined || lastPage === undefined)
    throw new Error("The evidence export did not read any dataset pages.");
  return {
    ...firstPage,
    scannedRecordCount,
    selectionScanTruncated: lastPage.selectionScanTruncated,
    ...(lastPage.continueCursor === undefined
      ? { continueCursor: undefined }
      : { continueCursor: lastPage.continueCursor }),
    records,
  };
}

const refs = {
  beginResearch: makeFunctionReference<
    "mutation",
    { jobId: string; executionToken: string },
    { query: string } | null
  >("evidenceJobs:beginResearchExecution"),
  beginExport: makeFunctionReference<
    "mutation",
    { jobId: string; executionToken: string },
    {
      datasetId: Id<"evidenceDatasets">;
      format: "jsonl" | "parquet";
      recordLimit: number;
      selectionStrategy: "balanced" | "recent";
      publicationEpoch: number;
      cursor?: string;
    } | null
  >("evidenceJobs:beginExportExecution"),
  searchPublic: makeFunctionReference<
    "query",
    { search: string; limit: number },
    Source[]
  >("evidence:searchPublic"),
  exportDocuments: makeFunctionReference<
    "query",
    {
      datasetId: string;
      limit: number;
      selectionStrategy?: "balanced" | "recent";
      cursor?: string;
    },
    ExportBundle
  >("evidenceJobs:readExportDocuments"),
  recordSystemSnapshot: makeFunctionReference<
    "mutation",
    {
      publicationEpoch: number;
      datasetId: Id<"evidenceDatasets">;
      checksum: string;
      recordCount: number;
      schemaVersion: string;
      artifactByteLength: number;
      sourceCount: number;
      configuredSourceCount: number;
      sourceCoverageScore: number;
      missingSourceKeys: string[];
      citationCount: number;
      citationCoverageScore: number;
      entityCount: number;
      entityCoverageScore: number;
      claimCount: number;
      claimCoverageScore: number;
      completenessScore: number;
      freshnessScore: number;
      earliestObservedAt?: number;
      latestObservedAt?: number;
      qualityMetricsJson: string;
      manifestStorageId: Id<"_storage">;
      artifactStorageId: Id<"_storage">;
      selectionStrategy?: "balanced" | "recent";
      scannedRecordCount?: number;
      selectionScanTruncated?: boolean;
      continueCursor?: string;
    },
    { versionId: Id<"evidenceDatasetVersions">; created: boolean }
  >("evidenceJobs:recordSystemDatasetSnapshot"),
  activeDatasetIds: makeFunctionReference<
    "query",
    Record<string, never>,
    Array<Id<"evidenceDatasets">>
  >("evidenceJobs:listActiveDatasetIds"),
  materializeSnapshot: makeFunctionReference<
    "action",
    { datasetId: Id<"evidenceDatasets"> },
    {
      versionId: Id<"evidenceDatasetVersions">;
      created: boolean;
      recordCount: number;
      checksum: string;
    }
  >("evidenceJobActions:materializeDatasetSnapshot"),
};
async function checksum(value: string | Uint8Array) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function metadata(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export const runResearch = internalAction({
  args: {
    jobId: v.id("evidenceResearchJobs"),
    executionToken: v.string(),
  },
  returns: v.union(
    v.object({ started: v.literal(false) }),
    v.object({
      started: v.literal(true),
      resultJson: v.string(),
      resultStorageId: v.optional(v.id("_storage")),
      artifactContentType: v.optional(v.string()),
      artifactByteLength: v.optional(v.number()),
      artifactSha256: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const input = await ctx.runMutation(refs.beginResearch, {
      jobId: args.jobId,
      executionToken: args.executionToken,
    });
    if (input === null) return { started: false as const };
    const sources = await ctx.runQuery(refs.searchPublic, {
      search: input.query,
      limit: MAX_SOURCES,
    });
    const cited = sources.map((source: Source) => ({
      documentId: source.documentId,
      versionId: source.currentVersionId,
      title: source.title,
      excerpt: source.excerpt,
      canonicalUrl: source.canonicalUrl,
      kind: source.kind,
      updatedAt: source.updatedAt,
    }));
    const promptSources = compactEvidenceResearchSources(input.query, cited);
    let markdown = buildExtractiveEvidenceDigest(input.query, promptSources);
    let route: { provider: string; model: string } | null = null;
    let acceptedGeneratedOutput = false;
    let fallback:
      "deterministic-extractive" | "invalid-model-citations" | null =
      "deterministic-extractive";
    const generationStartedAt = Date.now();
    let generationResult: {
      route: {
        provider: string;
        persistedModel: string;
        reservationKey?: string;
        reservationModel?: string;
        providerReportedCostMicroUsd?: number;
      };
      value: {
        text: string;
        modelId: string;
        inputTokens?: number;
        outputTokens?: number;
        usage: { raw?: unknown };
      };
    } | null = null;
    if (promptSources.length > 0) {
      const researchPrompt = buildEvidenceResearchPrompt(
        input.query,
        promptSources,
      );
      try {
        const config = await convexModelRoutingConfig(ctx, {
          correlationId: `evidence-research:${args.jobId}`,
        });
        generationResult = await runWithModelFallback(config, {
          stage: "evidence-research",
          correlationId: `evidence-research:${args.jobId}`,
          feature: "evidence-research",
          totalTimeoutMs: 120_000,
          estimatedInputTokens: estimatePromptInputTokens(researchPrompt),
          maxOutputTokens: 1_200,
          run: async (candidate: RoutedModel, signal: AbortSignal) => {
            const result = await generateText({
              model: candidate.model,
              prompt: researchPrompt,
              maxOutputTokens: 1_200,
              temperature: 0,
              reasoning: "low",
              maxRetries: 0,
              providerOptions: candidate.providerOptions,
              abortSignal: signal,
            });
            return {
              text: result.text.trim(),
              modelId: result.response.modelId,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              usage: result.usage,
            };
          },
        });
      } catch {
        /* Preserve the deterministic extractive fallback when routing fails. */
      }
    }

    if (generationResult !== null) {
      const candidateMarkdown = generationResult.value.text.trim();
      route = {
        provider: generationResult.route.provider,
        model:
          generationResult.value.modelId ||
          generationResult.route.persistedModel,
      };
      if (
        candidateMarkdown &&
        hasGroundedEvidenceResearchCitations(candidateMarkdown, promptSources)
      ) {
        markdown = candidateMarkdown;
        acceptedGeneratedOutput = true;
        fallback = null;
      } else {
        fallback = "invalid-model-citations";
        markdown = buildExtractiveEvidenceDigest(input.query, promptSources);
      }
      await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
        runKey: `evidence-research:${args.jobId}`,
        reservationKey: generationResult.route.reservationKey,
        reservationModel: generationResult.route.reservationModel,
        agentSlug: "evidence-research",
        stage: "research",
        model: generationResult.route.persistedModel,
        servedModel: generationResult.value.modelId,
        providerReportedCostMicroUsd:
          generationResult.route.providerReportedCostMicroUsd,
        inputTokens: generationResult.value.inputTokens,
        outputTokens: generationResult.value.outputTokens,
        durationMs: Date.now() - generationStartedAt,
      });
    }
    const resultJson = JSON.stringify({
      query: input.query,
      markdown,
      sources: cited,
      generated: acceptedGeneratedOutput,
      route,
      fallback,
    });
    const artifact = new Blob([resultJson], { type: "application/json" });
    let resultStorageId: Id<"_storage"> | undefined;
    try {
      resultStorageId = await ctx.storage.store(artifact);
      return {
        started: true as const,
        resultJson,
        resultStorageId,
        artifactContentType: artifact.type,
        artifactByteLength: artifact.size,
        artifactSha256: await checksum(resultJson),
      };
    } catch (error) {
      if (resultStorageId !== undefined) {
        try {
          await ctx.storage.delete(resultStorageId);
        } catch {
          // Preserve the original execution error. Abrupt termination after a
          // successful store remains an unavoidable storage orphan boundary.
        }
      }
      throw error;
    }
  },
});

export const runExport = internalAction({
  args: { jobId: v.id("evidenceExportJobs"), executionToken: v.string() },
  returns: v.union(
    v.object({ started: v.literal(false) }),
    v.object({
      started: v.literal(true),
      resultJson: v.string(),
      resultStorageId: v.id("_storage"),
      datasetManifestStorageId: v.id("_storage"),
      checksum: v.string(),
      recordCount: v.number(),
      artifactContentType: v.string(),
      artifactByteLength: v.number(),
      schemaVersion: v.string(),
      sourceCount: v.number(),
      configuredSourceCount: v.number(),
      sourceCoverageScore: v.number(),
      missingSourceKeys: v.array(v.string()),
      citationCount: v.number(),
      citationCoverageScore: v.number(),
      entityCount: v.number(),
      entityCoverageScore: v.number(),
      claimCount: v.number(),
      claimCoverageScore: v.number(),
      completenessScore: v.number(),
      freshnessScore: v.number(),
      earliestObservedAt: v.optional(v.number()),
      latestObservedAt: v.optional(v.number()),
      qualityMetricsJson: v.string(),
      selectionStrategy: v.union(v.literal("balanced"), v.literal("recent")),
      scannedRecordCount: v.number(),
      selectionScanTruncated: v.boolean(),
      continueCursor: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const input = await ctx.runMutation(refs.beginExport, {
      jobId: args.jobId,
      executionToken: args.executionToken,
    });
    if (input === null) return { started: false as const };
    const bundle = await readExportPages(ctx, {
      datasetId: input.datasetId,
      recordLimit: input.recordLimit,
      queryPageSize: EXPORT_QUERY_PAGE_SIZE,
      selectionStrategy: input.selectionStrategy,
      cursor: input.cursor,
    });
    if (bundle.publicationEpoch !== input.publicationEpoch)
      throw new Error(
        "Evidence publication policy changed while the export was starting. Create a new export job.",
      );
    const records = bundle.records.map((record) => ({
      ...record,
      version:
        record.version === null
          ? null
          : {
              ...record.version,
              metadata: metadata(record.version.metadataJson),
              metadataJson: undefined,
            },
    }));
    const serialized = serializeEvidenceExport(input.format, records);
    const artifact = new Blob([serialized.bytes], {
      type: serialized.contentType,
    });
    const resultChecksum = await checksum(serialized.bytes);
    const generatedAt = new Date().toISOString();
    const manifest = buildEvidenceDatasetManifest({
      datasetKey: bundle.dataset.datasetKey,
      datasetName: bundle.dataset.name,
      format: input.format,
      selection: {
        includedKinds: bundle.dataset.includedKinds,
        includedLicenseClasses: bundle.dataset.includedLicenseClasses,
        sourceKeys: bundle.dataset.sourceKeys,
      },
      scannedRecordCount: bundle.scannedRecordCount,
      selectionScanTruncated: bundle.selectionScanTruncated,
      selectionStrategy: bundle.selectionStrategy,
      snapshotAt: bundle.snapshotAt,
      continueCursor: bundle.continueCursor,
      artifactChecksum: resultChecksum,
      artifactByteLength: artifact.size,
      generatedAt,
      records: bundle.records,
    });
    const qualityMetricsJson = JSON.stringify({
      coverage: manifest.coverage,
      distributions: manifest.distributions,
    });
    let resultStorageId: Id<"_storage"> | undefined;
    let datasetManifestStorageId: Id<"_storage"> | undefined;
    try {
      resultStorageId = await ctx.storage.store(artifact);
      datasetManifestStorageId = await ctx.storage.store(
        new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      );
      return {
        started: true as const,
        resultJson: JSON.stringify({
          format: input.format,
          recordCount: records.length,
          checksum: resultChecksum,
          containsRawPayload: false,
          schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
          dataset: manifest.dataset,
          coverage: manifest.coverage,
          selectionStrategy: bundle.selectionStrategy,
          snapshotAt: bundle.snapshotAt,
          continueCursor: bundle.continueCursor ?? null,
        }),
        resultStorageId,
        datasetManifestStorageId,
        checksum: resultChecksum,
        recordCount: records.length,
        artifactContentType: artifact.type,
        artifactByteLength: artifact.size,
        schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
        sourceCount: manifest.coverage.sourceCount,
        configuredSourceCount: manifest.coverage.configuredSourceCount,
        sourceCoverageScore: manifest.coverage.sourceCoverageScore,
        missingSourceKeys: manifest.coverage.missingSourceKeys,
        citationCount: manifest.coverage.citationCount,
        citationCoverageScore: manifest.coverage.citationCoverageScore,
        entityCount: manifest.coverage.entityCount,
        entityCoverageScore: manifest.coverage.entityCoverageScore,
        claimCount: manifest.coverage.claimCount,
        claimCoverageScore: manifest.coverage.claimCoverageScore,
        completenessScore: manifest.coverage.completenessScore,
        freshnessScore: manifest.coverage.freshnessScore,
        ...(manifest.coverage.earliestObservedAt === null
          ? {}
          : { earliestObservedAt: manifest.coverage.earliestObservedAt }),
        ...(manifest.coverage.latestObservedAt === null
          ? {}
          : { latestObservedAt: manifest.coverage.latestObservedAt }),
        qualityMetricsJson,
        selectionStrategy: bundle.selectionStrategy,
        scannedRecordCount: bundle.scannedRecordCount,
        selectionScanTruncated: bundle.selectionScanTruncated,
        ...(bundle.continueCursor === undefined
          ? {}
          : { continueCursor: bundle.continueCursor }),
      };
    } catch (error) {
      for (const storageId of [datasetManifestStorageId, resultStorageId]) {
        if (storageId === undefined) continue;
        try {
          await ctx.storage.delete(storageId);
        } catch {
          // Preserve the original execution error; cleanup is best effort.
        }
      }
      throw error;
    }
  },
});

/** Materializes an immutable, code-owned dataset snapshot for catalog readers. */
export const materializeDatasetSnapshot = internalAction({
  args: { datasetId: v.id("evidenceDatasets") },
  returns: v.object({
    versionId: v.id("evidenceDatasetVersions"),
    created: v.boolean(),
    recordCount: v.number(),
    checksum: v.string(),
  }),
  handler: async (ctx, args) => {
    const bundle = await readExportPages(ctx, {
      datasetId: args.datasetId,
      recordLimit: DATASET_SNAPSHOT_RECORD_LIMIT,
      queryPageSize: DATASET_SNAPSHOT_QUERY_PAGE_SIZE,
      selectionStrategy: "balanced",
    });
    const records = bundle.records.map((record) => ({
      ...record,
      version:
        record.version === null
          ? null
          : {
              ...record.version,
              metadata: metadata(record.version.metadataJson),
              metadataJson: undefined,
            },
    }));
    const jsonl =
      records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length ? "\n" : "");
    const artifact = new Blob([jsonl], { type: "application/x-ndjson" });
    const resultChecksum = await checksum(jsonl);
    const manifest = buildEvidenceDatasetManifest({
      datasetKey: bundle.dataset.datasetKey,
      datasetName: bundle.dataset.name,
      selection: {
        includedKinds: bundle.dataset.includedKinds,
        includedLicenseClasses: bundle.dataset.includedLicenseClasses,
        sourceKeys: bundle.dataset.sourceKeys,
      },
      scannedRecordCount: bundle.scannedRecordCount,
      selectionScanTruncated: bundle.selectionScanTruncated,
      selectionStrategy: bundle.selectionStrategy,
      snapshotAt: bundle.snapshotAt,
      continueCursor: bundle.continueCursor,
      artifactChecksum: resultChecksum,
      artifactByteLength: artifact.size,
      generatedAt: new Date().toISOString(),
      records: bundle.records,
    });
    const qualityMetricsJson = JSON.stringify({
      coverage: manifest.coverage,
      distributions: manifest.distributions,
    });
    const artifactStorageId = await ctx.storage.store(artifact);
    const manifestStorageId = await ctx.storage.store(
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
    );
    const recorded = await ctx
      .runMutation(refs.recordSystemSnapshot, {
        publicationEpoch: bundle.publicationEpoch,
        datasetId: args.datasetId,
        checksum: resultChecksum,
        recordCount: manifest.artifact.recordCount,
        schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
        artifactByteLength: manifest.artifact.byteLength,
        sourceCount: manifest.coverage.sourceCount,
        configuredSourceCount: manifest.coverage.configuredSourceCount,
        sourceCoverageScore: manifest.coverage.sourceCoverageScore,
        missingSourceKeys: manifest.coverage.missingSourceKeys,
        citationCount: manifest.coverage.citationCount,
        citationCoverageScore: manifest.coverage.citationCoverageScore,
        entityCount: manifest.coverage.entityCount,
        entityCoverageScore: manifest.coverage.entityCoverageScore,
        claimCount: manifest.coverage.claimCount,
        claimCoverageScore: manifest.coverage.claimCoverageScore,
        completenessScore: manifest.coverage.completenessScore,
        freshnessScore: manifest.coverage.freshnessScore,
        earliestObservedAt: manifest.coverage.earliestObservedAt ?? undefined,
        latestObservedAt: manifest.coverage.latestObservedAt ?? undefined,
        qualityMetricsJson,
        manifestStorageId,
        artifactStorageId,
        selectionStrategy: bundle.selectionStrategy,
        scannedRecordCount: bundle.scannedRecordCount,
        selectionScanTruncated: bundle.selectionScanTruncated,
        continueCursor: bundle.continueCursor,
      })
      .catch(async (error: unknown) => {
        await Promise.all([
          ctx.storage.delete(artifactStorageId),
          ctx.storage.delete(manifestStorageId),
        ]);
        throw error;
      });
    if (!recorded.created) {
      await Promise.all([
        ctx.storage.delete(artifactStorageId),
        ctx.storage.delete(manifestStorageId),
      ]);
    }
    return {
      ...recorded,
      recordCount: manifest.artifact.recordCount,
      checksum: resultChecksum,
    };
  },
});

export const materializeAllDatasetSnapshots = internalAction({
  args: {},
  returns: v.object({
    datasets: v.number(),
    created: v.number(),
    unchanged: v.number(),
    records: v.number(),
  }),
  handler: async (ctx) => {
    const datasetIds = await ctx.runQuery(refs.activeDatasetIds, {});
    let created = 0;
    let records = 0;
    for (const datasetId of datasetIds) {
      const result = await ctx.runAction(refs.materializeSnapshot, {
        datasetId,
      });
      created += Number(result.created);
      records += result.recordCount;
    }
    return {
      datasets: datasetIds.length,
      created,
      unchanged: datasetIds.length - created,
      records,
    };
  },
});
