// @vitest-environment node

import { describe, expect, test } from "vitest";
import {
  buildForumAgentClaimCitations,
  deterministicForumClaimHash,
  resolveForumClaimBodySpan,
} from "./forumAgentClaimProvenance";

const snapshot = {
  id: "candidate-1",
  sourceKey: "source-primary",
  url: "https://example.com/release",
  articleTitle: "Release adds deterministic provenance",
  articleDescription: "The release records source-backed claim metadata.",
  articleText:
    "The release adds deterministic provenance records for every published claim.",
};

describe("forum agent claim provenance", () => {
  test("builds deterministic source-linked citation records", () => {
    const body =
      "The release adds deterministic provenance records for every published claim.";
    const first = buildForumAgentClaimCitations({
      body,
      snapshots: [snapshot],
      claims: [
        {
          claim: body,
          sourceCandidateId: snapshot.id,
          confidence: "high",
          kind: "fact",
        },
      ],
    });
    const second = buildForumAgentClaimCitations({
      body,
      snapshots: [snapshot],
      claims: [
        {
          claim: body,
          sourceCandidateId: snapshot.id,
          confidence: "high",
          kind: "fact",
        },
      ],
    });
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      claimHash: deterministicForumClaimHash(body),
      bodySpanStart: 0,
      bodySpanEnd: body.length,
      bodySpanMatch: "exact",
      sourceCandidateKey: snapshot.sourceKey,
      sourceUrl: snapshot.url,
      supportStatus: "supported",
      snapshotVersion: "forum-article-snapshot-v1",
    });
  });

  test("replaces mismatched offsets with the best lexical body span", () => {
    const body = [
      "[h2]Why it matters[/h2]",
      "Published claims now retain deterministic provenance from the primary release.",
      "A separate paragraph discusses operational review.",
    ].join("\n\n");
    const span = resolveForumClaimBodySpan(
      body,
      "The primary release says published claims retain deterministic provenance.",
      {
        bodySpanStart: 0,
        bodySpanEnd: 5,
        bodySpanText: "wrong",
        bodySpanMatch: "exact",
      },
    );
    expect(span).toMatchObject({
      bodySpanMatch: "lexical_fallback",
      bodySpanText:
        "Published claims now retain deterministic provenance from the primary release.",
    });
    expect(body.slice(span.bodySpanStart, span.bodySpanEnd)).toBe(
      span.bodySpanText,
    );
  });

  test("rejects a claim whose candidate snapshot is absent", () => {
    expect(() =>
      buildForumAgentClaimCitations({
        body: "A claim with no source snapshot should not be published.",
        snapshots: [snapshot],
        claims: [
          {
            claim: "A claim with no source snapshot should not be published.",
            sourceCandidateId: "missing",
            confidence: "medium",
            kind: "analysis",
          },
        ],
      }),
    ).toThrow(/missing snapshot/i);
  });
});
