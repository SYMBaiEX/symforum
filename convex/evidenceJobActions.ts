"use node";

import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { convexModelRoutingConfig } from "./modelRouting";
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
  documentId: string;
  versionId: string | null;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  kind: string;
  licenseClass: string;
  publishedAt: number | null;
  updatedAt: number;
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
    ExportRecord[]
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
              maxRetries: 0,
              providerOptions: candidate.providerOptions,
              abortSignal: signal,
            });
            return result.text.trim();
          },
        },
      );
      markdown = generated.value || markdown;
      route = {
        provider: generated.route.provider,
        model: generated.route.persistedModel,
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
    const records = await ctx.runQuery(refs.exportDocuments, {
      datasetId: input.datasetId,
      limit: 100,
    });
    const jsonl =
      records.map((record: ExportRecord) => JSON.stringify(record)).join("\n") +
      (records.length ? "\n" : "");
    const artifact = new Blob([jsonl], { type: "application/x-ndjson" });
    const resultStorageId = await ctx.storage.store(artifact);
    const resultChecksum = await checksum(jsonl);
    const datasetManifestStorageId = await ctx.storage.store(
      new Blob(
        [
          JSON.stringify({
            format: "jsonl",
            checksum: resultChecksum,
            recordCount: records.length,
            generatedAt: new Date().toISOString(),
            containsRawPayload: false,
          }),
        ],
        { type: "application/json" },
      ),
    );
    return {
      resultJson: JSON.stringify({
        format: "jsonl",
        recordCount: records.length,
        checksum: resultChecksum,
        containsRawPayload: false,
      }),
      resultStorageId,
      datasetManifestStorageId,
      checksum: resultChecksum,
      recordCount: records.length,
      artifactContentType: artifact.type,
      artifactByteLength: artifact.size,
    };
  },
});
