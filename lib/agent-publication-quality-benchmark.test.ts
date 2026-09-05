import { describe, expect, test } from "vitest";
import {
  PUBLICATION_QUALITY_BENCHMARK,
  runPublicationQualityBenchmark,
} from "./agent-publication-quality-benchmark";

describe("agent publication quality benchmark", () => {
  test("keeps every labeled editorial case calibrated", () => {
    const result = runPublicationQualityBenchmark();
    expect(PUBLICATION_QUALITY_BENCHMARK.length).toBeGreaterThanOrEqual(5);
    expect(result).toMatchObject({
      schemaVersion: "symbaiex-publication-quality-benchmark-v1",
      total: PUBLICATION_QUALITY_BENCHMARK.length,
      passed: PUBLICATION_QUALITY_BENCHMARK.length,
      score: 100,
    });
  });
});
