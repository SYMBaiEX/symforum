import { describe, expect, it } from "vitest";
import { z } from "zod";
import portableSchema from "./schema.json";
import { forumContentDataset, forumContentHoldoutCases, forumContentTrainCases } from "./dataset";
import { forumContentDatasetSchema, forumContentStyleSchema } from "./schema";

describe("forum editorial evaluation fixtures", () => {
  it("keeps the portable JSON schema aligned with the typed contract", () => {
    expect(portableSchema).toEqual(z.toJSONSchema(forumContentDatasetSchema));
  });

  it("keeps topic families disjoint and covers every style in both splits", () => {
    expect(forumContentTrainCases).toHaveLength(24);
    expect(forumContentHoldoutCases).toHaveLength(12);
    const trainFamilies = new Set(forumContentTrainCases.map((item) => item.family));
    expect(forumContentHoldoutCases.every((item) => !trainFamilies.has(item.family))).toBe(true);
    for (const split of [forumContentTrainCases, forumContentHoldoutCases]) {
      expect(new Set(split.map((item) => item.style))).toEqual(new Set(forumContentStyleSchema.options));
      expect(new Set(split.map((item) => item.depth))).toEqual(new Set(["short", "medium", "long"]));
      expect(split.some((item) => item.task === "abstain")).toBe(true);
      expect(split.some((item) => item.task === "reply")).toBe(true);
    }
  });

  it("makes all provenance and expected source references resolvable", () => {
    const cases = forumContentDataset.cases;
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    const research = new Set(forumContentDataset.sourceResearch.map((item) => item.id));
    for (const item of cases) {
      const evidence = new Set(item.evidence.map((entry) => entry.id));
      expect(evidence.size).toBe(item.evidence.length);
      expect(item.researchSourceIds.every((id) => research.has(id))).toBe(true);
      expect(item.expected.requiredSourceIds.every((id) => evidence.has(id))).toBe(true);
      expect(item.expected.wordRange[0]).toBeLessThanOrEqual(item.expected.wordRange[1]);
      expect(item.expected.publicationDecision).toBe(item.task === "abstain" ? "abstain" : "publish");
      for (const check of item.expected.checks) {
        if (check.kind.endsWith("regex")) expect(() => new RegExp(check.value, "i")).not.toThrow();
      }
      for (const entry of item.evidence) {
        expect(entry.synthetic).toBe(true);
        if (entry.url) expect(new URL(entry.url).hostname.endsWith(".invalid")).toBe(true);
      }
    }
  });

  it("rejects unlabeled evidence and unknown case fields instead of silently accepting drift", () => {
    const invalidEvidence = structuredClone(forumContentDataset);
    Reflect.deleteProperty(invalidEvidence.cases[0].evidence[0], "synthetic");
    expect(forumContentDatasetSchema.safeParse(invalidEvidence).success).toBe(false);
    const invalidField = structuredClone(forumContentDataset);
    Reflect.set(invalidField.cases[0], "memorizedPost", "A copied source post");
    expect(forumContentDatasetSchema.safeParse(invalidField).success).toBe(false);
  });
});
