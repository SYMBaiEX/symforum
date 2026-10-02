import { defaultChunker } from "@convex-dev/rag";
import { embed, embedMany, type EmbeddingModel } from "ai";

export type PreEmbeddedRagChunk = {
  text: string;
  embedding: number[];
};

/**
 * The RAG component calls AI SDK embedding functions without setting
 * `maxRetries`; AI SDK's default is two retries. Prepare embeddings here so
 * each budget reservation covers one provider attempt, and pass vectors into
 * RAG instead of letting the component make hidden requests.
 */
export async function embedRagQuery(
  model: EmbeddingModel,
  value: string,
  abortSignal?: AbortSignal,
) {
  const result = await embed({
    model,
    value,
    maxRetries: 0,
    abortSignal,
  });
  return { embedding: result.embedding, inputTokens: result.usage.tokens };
}

/** Preserve Convex RAG's default chunks while making retry and concurrency caps explicit. */
export async function embedRagText(
  model: EmbeddingModel,
  value: string,
  abortSignal?: AbortSignal,
): Promise<{ chunks: PreEmbeddedRagChunk[]; inputTokens: number }> {
  const texts = defaultChunker(value);
  if (texts.length === 0) return { chunks: [], inputTokens: 0 };

  const result = await embedMany({
    model,
    values: texts,
    maxRetries: 0,
    maxParallelCalls: 1,
    abortSignal,
  });
  return {
    chunks: texts.map((text, index) => ({
      text,
      embedding: result.embeddings[index],
    })),
    inputTokens: result.usage.tokens,
  };
}
