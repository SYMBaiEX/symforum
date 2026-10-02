import { unsupportedVerifiableTokens } from "./editorial-quality";

export type BelleDigestBriefForGrounding = {
  hnItemId: number;
  summary: string;
  analysis: string;
};

export type BelleDigestSourceForGrounding = {
  hnItemId: number;
  sourceText: string;
};

export type BelleDigestGroundingIssue = {
  code:
    | "duplicate_expected_story"
    | "duplicate_source"
    | "duplicate_brief"
    | "missing_brief"
    | "unexpected_brief"
    | "missing_source"
    | "unsupported_verifiable_token"
    | "unsupported_editorial_token";
  hnItemId?: number;
  field?: string;
  tokens?: string[];
};

/**
 * Deterministic, source-local checks for Belle's multi-story digest. A brief
 * must map one-to-one to the selected story and may not add factual precision
 * absent from that story's article extract.
 */
export function evaluateBelleDigestGrounding(args: {
  expectedStoryIds: readonly number[];
  briefs: readonly BelleDigestBriefForGrounding[];
  sources: readonly BelleDigestSourceForGrounding[];
  editorialText?: readonly { field: string; text: string }[];
}) {
  const issues: BelleDigestGroundingIssue[] = [];
  const expected = new Set<number>();
  for (const hnItemId of args.expectedStoryIds) {
    if (expected.has(hnItemId)) {
      issues.push({ code: "duplicate_expected_story", hnItemId });
    }
    expected.add(hnItemId);
  }

  const sourceByStory = new Map<number, string>();
  for (const source of args.sources) {
    if (sourceByStory.has(source.hnItemId)) {
      issues.push({ code: "duplicate_source", hnItemId: source.hnItemId });
    } else {
      sourceByStory.set(source.hnItemId, source.sourceText);
    }
  }

  const seenBriefs = new Set<number>();
  const briefsById = new Map<number, BelleDigestBriefForGrounding>();
  for (const brief of args.briefs) {
    if (seenBriefs.has(brief.hnItemId)) {
      issues.push({ code: "duplicate_brief", hnItemId: brief.hnItemId });
      continue;
    }
    seenBriefs.add(brief.hnItemId);
    briefsById.set(brief.hnItemId, brief);
    if (!expected.has(brief.hnItemId)) {
      issues.push({ code: "unexpected_brief", hnItemId: brief.hnItemId });
    }
  }

  for (const hnItemId of expected) {
    const brief = briefsById.get(hnItemId);
    if (brief === undefined) {
      issues.push({ code: "missing_brief", hnItemId });
      continue;
    }
    const sourceText = sourceByStory.get(hnItemId);
    if (sourceText === undefined || !sourceText.trim()) {
      issues.push({ code: "missing_source", hnItemId });
      continue;
    }
    const tokens = unsupportedVerifiableTokens(
      `${brief.summary}\n${brief.analysis}`,
      sourceText,
    );
    if (tokens.length > 0) {
      issues.push({
        code: "unsupported_verifiable_token",
        hnItemId,
        tokens,
      });
    }
  }

  const combinedSourceText = [...sourceByStory.values()].join(" ");
  for (const item of args.editorialText ?? []) {
    const tokens = unsupportedVerifiableTokens(item.text, combinedSourceText);
    if (tokens.length > 0) {
      issues.push({
        code: "unsupported_editorial_token",
        field: item.field,
        tokens,
      });
    }
  }

  return {
    passed: issues.length === 0,
    expectedStoryCount: expected.size,
    briefCount: args.briefs.length,
    issues,
  };
}
