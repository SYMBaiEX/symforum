export type MeteredEmbeddingResult<TResult> =
  | { ok: true; value: TResult; inputTokens: number }
  | { ok: false; stage: "embedding"; error: unknown }
  | {
      ok: false;
      stage: "settlement";
      error: unknown;
      inputTokens: number;
    }
  | {
      ok: false;
      stage: "downstream";
      error: unknown;
      inputTokens: number;
    };

/**
 * Settle a billable embedding as soon as its provider call completes, before
 * invoking downstream RAG storage or search. That keeps provider usage
 * attributable even when the RAG operation fails, while preventing RAG work
 * from continuing if the reservation cannot be reconciled.
 */
export async function runMeteredEmbedding<TEmbedding, TResult>(args: {
  embed: () => Promise<{ value: TEmbedding; inputTokens: number }>;
  settleUsage: (inputTokens: number) => Promise<unknown>;
  useEmbedding: (value: TEmbedding) => Promise<TResult>;
}): Promise<MeteredEmbeddingResult<TResult>> {
  let embedded: { value: TEmbedding; inputTokens: number };
  try {
    embedded = await args.embed();
  } catch (error) {
    return { ok: false, stage: "embedding", error };
  }

  try {
    await args.settleUsage(embedded.inputTokens);
  } catch (error) {
    return {
      ok: false,
      stage: "settlement",
      error,
      inputTokens: embedded.inputTokens,
    };
  }

  try {
    return {
      ok: true,
      value: await args.useEmbedding(embedded.value),
      inputTokens: embedded.inputTokens,
    };
  } catch (error) {
    return {
      ok: false,
      stage: "downstream",
      error,
      inputTokens: embedded.inputTokens,
    };
  }
}
