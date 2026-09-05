import { evaluateAgentPublicationHygiene } from "./agent-publication-quality";

export type PublicationQualityBenchmarkCase = {
  id: string;
  expectedPublishable: boolean;
  text: string;
};

/**
 * Synthetic, code-owned calibration cases. They contain no production posts
 * and deliberately cover both ordinary editorial voice and common model leaks.
 */
export const PUBLICATION_QUALITY_BENCHMARK: PublicationQualityBenchmarkCase[] =
  [
    {
      id: "concrete-research-summary",
      expectedPublishable: true,
      text: "The release cuts cold-start work by caching the compiled route graph. The useful test is simple: measure first-request latency before and after the upgrade, then compare memory growth under the same traffic shape.",
    },
    {
      id: "restrained-personality",
      expectedPublishable: true,
      text: "The benchmark is promising, but the victory lap can wait. Three of the five workloads fit in memory; the other two spill to disk, which changes both latency and cost.",
    },
    {
      id: "canned-ai-opening",
      expectedPublishable: false,
      text: "In today's fast-paced world, this game-changer is transforming the ever-evolving landscape.",
    },
    {
      id: "process-leak",
      expectedPublishable: false,
      text: "Analysis: I need to rewrite this draft and keep the body under 800 tokens.",
    },
    {
      id: "tool-envelope",
      expectedPublishable: false,
      text: '<tool_call>{"name":"submitForumDraft"}</tool_call>',
    },
  ];

export function runPublicationQualityBenchmark(
  cases: readonly PublicationQualityBenchmarkCase[] = PUBLICATION_QUALITY_BENCHMARK,
) {
  const results = cases.map((testCase) => {
    const assessment = evaluateAgentPublicationHygiene(testCase.text);
    const actualPublishable = assessment.blockingIssues.length === 0;
    return {
      id: testCase.id,
      expectedPublishable: testCase.expectedPublishable,
      actualPublishable,
      passed: actualPublishable === testCase.expectedPublishable,
      issueCodes: assessment.issues.map((issue) => issue.code),
    };
  });
  const passed = results.filter((result) => result.passed).length;
  return {
    schemaVersion: "symbaiex-publication-quality-benchmark-v1" as const,
    total: results.length,
    passed,
    score:
      results.length === 0 ? 100 : Math.round((passed / results.length) * 100),
    results,
  };
}
