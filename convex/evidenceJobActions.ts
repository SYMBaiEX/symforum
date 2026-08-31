"use node";

import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { convexModelRoutingConfig } from "./modelRouting";
import {
  buildEvidenceDatasetManifest,
  EVIDENCE_EXPORT_SCHEMA_VERSION,
} from "../lib/evidence-dataset-manifest";
import {
  runWithModelFallback,
  type RoutedModel,
} from "../lib/ai-model-routing";

const MAX_SOURCES = 10;
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
};
type ExportBundle = {
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
  records: ExportRecord[];
};
const refs = {
  researchInput: makeFunctionReference<
    "query",
    { jobId: string },
    { query: string } | null
  >("evidenceJobs:readResearchInput"),
  exportInput: makeFunctionReference<
    "query",
    { jobId: string },
    { datasetId: string; format: "jsonl" | "parquet" } | null
  >("evidenceJobs:readExportInput"),
  searchPublic: makeFunctionReference<
    "query",
    { search: string; limit: number },
    Source[]
  >("evidence:searchPublic"),
  exportDocuments: makeFunctionReference<
    "query",
    { datasetId: string; limit: number },
    ExportBundle
  >("evidenceJobs:readExportDocuments"),
};
async function checksum(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function metadata(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function extractiveDigest(
  query: string,
  sources: Array<{ title: string; excerpt: string; canonicalUrl: string }>,
) {
  const citations = sources
    .map(
      (source, index) =>
        `- [${index + 1}] ${source.title}: ${source.excerpt} (${source.canonicalUrl})`,
    )
    .join("\n");
  return `# Evidence digest\n\nQuery: ${query}\n\nRouting unavailable; this is a deterministic extractive digest, not generated analysis.\n\n${citations}`;
}

export const runResearch = internalAction({
  args: { jobId: v.id("evidenceResearchJobs") },
  returns: v.object({
    resultJson: v.string(),
    resultStorageId: v.optional(v.id("_storage")),
    artifactContentType: v.optional(v.string()),
    artifactByteLength: v.optional(v.number()),
    artifactSha256: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(refs.researchInput, {
      jobId: args.jobId,
    });
    if (input === null)
      throw new Error("Evidence research job does not exist.");
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
    let markdown = extractiveDigest(input.query, cited);
    let route: { provider: string; model: string } | null = null;
    try {
      const config = await convexModelRoutingConfig(ctx, {
        correlationId: `evidence-research:${args.jobId}`,
      });
      const generated = await runWithModelFallback(
        config,
        { user: "evidence-research", tags: ["feature:evidence-research"] },
        {
          stage: "evidence-research",
          correlationId: `evidence-research:${args.jobId}`,
          feature: "evidence-research",
          totalTimeoutMs: 120_000,
          run: async (candidate: RoutedModel, signal: AbortSignal) => {
            const result = await generateText({
              model: candidate.model,
              prompt: `Write a concise cited Markdown evidence brief for the query ${JSON.stringify(input.query)}. Use only the supplied source excerpts. Do not infer claims not present in them. Cite each factual statement with [n].\n\nSources:\n${cited.map((source, index) => `[${index + 1}] ${source.title}\n${source.excerpt}\n${source.canonicalUrl}`).join("\n\n")}`,
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
            };
          },
        },
      );
      markdown = generated.value.text || markdown;
      route = {
        provider: generated.route.provider,
        model: generated.value.modelId || generated.route.persistedModel,
      };
    } catch {
      /* Explicit deterministic fallback is persisted below. */
    }
    const resultJson = JSON.stringify({
      query: input.query,
      markdown,
      sources: cited,
      generated: route !== null,
      route,
      fallback: route === null ? "deterministic-extractive" : null,
    });
    const artifact = new Blob([resultJson], { type: "application/json" });
    const resultStorageId = await ctx.storage.store(artifact);
    return {
      resultJson,
      resultStorageId,
      artifactContentType: artifact.type,
      artifactByteLength: artifact.size,
      artifactSha256: await checksum(resultJson),
    };
  },
});

export const runExport = internalAction({
  args: { jobId: v.id("evidenceExportJobs") },
  returns: v.object({
    resultJson: v.string(),
    resultStorageId: v.id("_storage"),
    datasetManifestStorageId: v.id("_storage"),
    checksum: v.string(),
    recordCount: v.number(),
    artifactContentType: v.string(),
    artifactByteLength: v.number(),
    schemaVersion: v.string(),
    sourceCount: v.number(),
    citationCount: v.number(),
    completenessScore: v.number(),
    freshnessScore: v.number(),
    earliestObservedAt: v.optional(v.number()),
    latestObservedAt: v.optional(v.number()),
    qualityMetricsJson: v.string(),
  }),
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(refs.exportInput, {
      jobId: args.jobId,
    });
    if (input === null) throw new Error("Evidence export job does not exist.");
    if (input.format !== "jsonl")
      throw new Error(
        "PARQUET_UNSUPPORTED: only jsonl export is currently supported.",
      );
    const bundle = await ctx.runQuery(refs.exportDocuments, {
      datasetId: input.datasetId,
      limit: 100,
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
    const resultStorageId = await ctx.storage.store(artifact);
    const resultChecksum = await checksum(jsonl);
    const generatedAt = new Date().toISOString();
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
      artifactChecksum: resultChecksum,
      artifactByteLength: artifact.size,
      generatedAt,
      records: bundle.records,
    });
    const datasetManifestStorageId = await ctx.storage.store(
      new Blob(
        [JSON.stringify(manifest)],
        { type: "application/json" },
      ),
    );
    const qualityMetricsJson = JSON.stringify({
      coverage: manifest.coverage,
      distributions: manifest.distributions,
    });
    return {
      resultJson: JSON.stringify({
        format: "jsonl",
        recordCount: records.length,
        checksum: resultChecksum,
        containsRawPayload: false,
        schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
        dataset: manifest.dataset,
        coverage: manifest.coverage,
      }),
      resultStorageId,
      datasetManifestStorageId,
      checksum: resultChecksum,
      recordCount: records.length,
      artifactContentType: artifact.type,
      artifactByteLength: artifact.size,
      schemaVersion: EVIDENCE_EXPORT_SCHEMA_VERSION,
      sourceCount: manifest.coverage.sourceCount,
      citationCount: manifest.coverage.citationCount,
      completenessScore: manifest.coverage.completenessScore,
      freshnessScore: manifest.coverage.freshnessScore,
      ...(manifest.coverage.earliestObservedAt === null
        ? {}
        : { earliestObservedAt: manifest.coverage.earliestObservedAt }),
      ...(manifest.coverage.latestObservedAt === null
        ? {}
        : { latestObservedAt: manifest.coverage.latestObservedAt }),
      qualityMetricsJson,
    };
  },
});
