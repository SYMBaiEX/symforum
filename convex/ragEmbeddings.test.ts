import { defaultChunker } from "@convex-dev/rag";
import type { EmbeddingModel } from "ai";
import { describe, expect, test, vi } from "vitest";
import { embedRagQuery, embedRagText } from "./ragEmbeddings";

function testEmbeddingModel(
  doEmbed: (args: { values: string[] }) => Promise<{
    embeddings: number[][];
    usage: { tokens: number };
  }>,
  options: { maxEmbeddingsPerCall?: number; supportsParallelCalls?: boolean } = {},
) {
  return {
    specificationVersion: "v4",
    provider: "test-provider",
    modelId: "test-embedding",
    maxEmbeddingsPerCall: options.maxEmbeddingsPerCall ?? 100,
    supportsParallelCalls: options.supportsParallelCalls ?? false,
    doEmbed,
  } as unknown as EmbeddingModel;
}

describe("RAG embeddings", () => {
  test("query embedding does not retry provider failures", async () => {
    const doEmbed = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(
      embedRagQuery(testEmbeddingModel(doEmbed), "bounded query"),
    ).rejects.toThrow("provider unavailable");
    expect(doEmbed).toHaveBeenCalledTimes(1);
  });

  test("text embedding preserves the RAG default chunker and reports usage", async () => {
    const text = `${"A paragraph with source-grounded evidence. ".repeat(30)}\n\n${"A second paragraph with separate context. ".repeat(30)}`;
    const doEmbed = vi.fn(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_, index) => [index + 1, 2, 3]),
      usage: { tokens: values.length * 7 },
    }));
    const expectedChunks = defaultChunker(text);

    const result = await embedRagText(testEmbeddingModel(doEmbed), text);

    expect(result.chunks.map((chunk) => chunk.text)).toEqual(expectedChunks);
    expect(result.chunks.map((chunk) => chunk.embedding)).toEqual(
      expectedChunks.map((_, index) => [index + 1, 2, 3]),
    );
    expect(result.inputTokens).toBe(expectedChunks.length * 7);
    expect(doEmbed).toHaveBeenCalledTimes(1);
  });

  test("text embedding does not retry provider failures", async () => {
    const doEmbed = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(
      embedRagText(testEmbeddingModel(doEmbed), "a short document"),
    ).rejects.toThrow("provider unavailable");
    expect(doEmbed).toHaveBeenCalledTimes(1);
  });

  test("provider-split embedding batches stay sequential", async () => {
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const doEmbed = vi.fn(async ({ values }: { values: string[] }) => {
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      await Promise.resolve();
      activeCalls -= 1;
      return {
        embeddings: values.map(() => [1, 2, 3]),
        usage: { tokens: values.length },
      };
    });
    const text = Array.from({ length: 8 }, () =>
      "Evidence paragraph with source-grounded facts. ".repeat(16),
    ).join("\n\n");
    const chunkCount = defaultChunker(text).length;

    await embedRagText(
      testEmbeddingModel(doEmbed, {
        maxEmbeddingsPerCall: 1,
        supportsParallelCalls: true,
      }),
      text,
    );

    expect(chunkCount).toBeGreaterThan(1);
    expect(doEmbed).toHaveBeenCalledTimes(chunkCount);
    expect(maximumActiveCalls).toBe(1);
  });

  test("empty documents do not call the embedding provider", async () => {
    const doEmbed = vi.fn();

    await expect(
      embedRagText(testEmbeddingModel(doEmbed), "\n\n  "),
    ).resolves.toEqual({ chunks: [], inputTokens: 0 });
    expect(doEmbed).not.toHaveBeenCalled();
  });
});
