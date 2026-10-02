import { expect, test, vi } from "vitest";
import { runMeteredEmbedding } from "./ai-usage-metering";

test("settles provider usage before running downstream RAG work", async () => {
  const calls: string[] = [];
  const result = await runMeteredEmbedding({
    embed: async () => {
      calls.push("embed");
      return { value: [0.1, 0.2], inputTokens: 17 };
    },
    settleUsage: async (inputTokens) => {
      calls.push(`settle:${inputTokens}`);
    },
    useEmbedding: async (embedding) => {
      calls.push(`rag:${embedding.length}`);
      return "stored";
    },
  });

  expect(result).toEqual({
    ok: true,
    value: "stored",
    inputTokens: 17,
  });
  expect(calls).toEqual(["embed", "settle:17", "rag:2"]);
});

test("does not settle or continue when the provider embedding fails", async () => {
  const error = new Error("provider unavailable");
  const settleUsage = vi.fn(async () => {});
  const useEmbedding = vi.fn(async () => "unused");

  const result = await runMeteredEmbedding({
    embed: async () => {
      throw error;
    },
    settleUsage,
    useEmbedding,
  });

  expect(result).toEqual({ ok: false, stage: "embedding", error });
  expect(settleUsage).not.toHaveBeenCalled();
  expect(useEmbedding).not.toHaveBeenCalled();
});

test("keeps the provider usage when a downstream RAG operation fails", async () => {
  const error = new Error("RAG index unavailable");
  const settleUsage = vi.fn(async () => {});

  const result = await runMeteredEmbedding({
    embed: async () => ({ value: [0.1], inputTokens: 23 }),
    settleUsage,
    useEmbedding: async () => {
      throw error;
    },
  });

  expect(result).toEqual({
    ok: false,
    stage: "downstream",
    error,
    inputTokens: 23,
  });
  expect(settleUsage).toHaveBeenCalledExactlyOnceWith(23);
});

test("does not run RAG work when usage settlement fails", async () => {
  const error = new Error("usage ledger unavailable");
  const useEmbedding = vi.fn(async () => "unused");

  const result = await runMeteredEmbedding({
    embed: async () => ({ value: [0.1], inputTokens: 29 }),
    settleUsage: async () => {
      throw error;
    },
    useEmbedding,
  });

  expect(result).toEqual({
    ok: false,
    stage: "settlement",
    error,
    inputTokens: 29,
  });
  expect(useEmbedding).not.toHaveBeenCalled();
});
