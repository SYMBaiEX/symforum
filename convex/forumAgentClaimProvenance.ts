import {
  lexicalEvidenceCoverage,
  unsupportedVerifiableTokens,
} from "../lib/editorial-quality";

export const FORUM_AGENT_CLAIM_SNAPSHOT_VERSION = "forum-article-snapshot-v1";

export type ForumAgentClaimCitationInput = {
  claimText: string;
  claimHash: string;
  bodySpanStart?: number;
  bodySpanEnd?: number;
  bodySpanText?: string;
  bodySpanMatch: "exact" | "lexical_fallback" | "unmatched";
  sourceCandidateId: string;
  sourceCandidateKey: string;
  sourceUrl: string;
  snapshotHash: string;
  snapshotVersion: string;
  kind: "fact" | "analysis";
  confidence: "high" | "medium";
  supportStatus: "supported" | "partial" | "unsupported";
  supportScore: number;
};

const MIN_SUPPORTED_CLAIM_COVERAGE = 0.45;

/**
 * Analysis may be published as a clearly partial inference when it adds no
 * unsupported verifiable detail. Facts require the normal support threshold.
 */
export function forumAgentClaimCitationsPassPublicationGate(
  citations: readonly ForumAgentClaimCitationInput[],
) {
  return citations.every(
    (citation) =>
      citation.supportStatus === "supported" ||
      (citation.kind === "analysis" && citation.supportStatus === "partial"),
  );
}

type ClaimInput = {
  claim: string;
  sourceCandidateId: string;
  confidence: "high" | "medium";
  kind: "fact" | "analysis";
};

type SnapshotInput = {
  id: string;
  sourceKey: string;
  url: string;
  articleTitle: string;
  articleDescription: string;
  articleText: string;
};

type ProposedSpan = Pick<
  ForumAgentClaimCitationInput,
  "bodySpanStart" | "bodySpanEnd" | "bodySpanText" | "bodySpanMatch"
>;

function normalizedHashText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Stable non-cryptographic content identifier for deterministic replay. */
export function deterministicForumClaimHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of normalizedHashText(value)) {
    const code = character.charCodeAt(0);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `fnv1a64-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function stripForumMarkup(value: string) {
  return value
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactSpan(body: string, claimText: string) {
  const exactStart = body.indexOf(claimText);
  if (exactStart >= 0) {
    return {
      bodySpanStart: exactStart,
      bodySpanEnd: exactStart + claimText.length,
      bodySpanText: claimText,
      bodySpanMatch: "exact" as const,
    };
  }
  const foldedStart = body
    .toLocaleLowerCase()
    .indexOf(claimText.toLocaleLowerCase());
  if (foldedStart < 0) return null;
  return {
    bodySpanStart: foldedStart,
    bodySpanEnd: foldedStart + claimText.length,
    bodySpanText: body.slice(foldedStart, foldedStart + claimText.length),
    bodySpanMatch: "exact" as const,
  };
}

/**
 * Resolve a citation to the stored body. Invalid caller offsets are ignored;
 * the best lexical sentence/block is used instead of persisting a false span.
 */
export function resolveForumClaimBodySpan(
  body: string,
  claimText: string,
  proposed?: ProposedSpan,
): ProposedSpan {
  if (
    proposed?.bodySpanStart !== undefined &&
    proposed.bodySpanEnd !== undefined &&
    proposed.bodySpanText !== undefined &&
    Number.isSafeInteger(proposed.bodySpanStart) &&
    Number.isSafeInteger(proposed.bodySpanEnd) &&
    proposed.bodySpanStart >= 0 &&
    proposed.bodySpanEnd > proposed.bodySpanStart &&
    proposed.bodySpanEnd <= body.length &&
    body.slice(proposed.bodySpanStart, proposed.bodySpanEnd) ===
      proposed.bodySpanText
  ) {
    return proposed;
  }

  const exact = exactSpan(body, claimText);
  if (exact !== null) return exact;

  const candidates = [...body.matchAll(/[^.!?\n]+[.!?]?/g)]
    .map((match) => {
      const raw = match[0] ?? "";
      const leading = raw.length - raw.trimStart().length;
      const spanText = raw.trim();
      const bodySpanStart = (match.index ?? 0) + leading;
      const plain = stripForumMarkup(spanText);
      return {
        bodySpanStart,
        bodySpanEnd: bodySpanStart + spanText.length,
        bodySpanText: spanText,
        plain,
        score: Math.max(
          lexicalEvidenceCoverage(claimText, plain),
          lexicalEvidenceCoverage(plain, claimText),
        ),
      };
    })
    .filter((candidate) => candidate.plain.split(/\s+/).length >= 3)
    .sort(
      (left, right) =>
        right.score - left.score || left.bodySpanStart - right.bodySpanStart,
    );
  const fallback = candidates[0];
  if (fallback === undefined || fallback.score <= 0) {
    return { bodySpanMatch: "unmatched" };
  }
  return {
    bodySpanStart: fallback.bodySpanStart,
    bodySpanEnd: fallback.bodySpanEnd,
    bodySpanText: fallback.bodySpanText,
    bodySpanMatch: "lexical_fallback",
  };
}

export function buildForumAgentClaimCitations(args: {
  claims: ClaimInput[];
  snapshots: SnapshotInput[];
  body: string;
}): ForumAgentClaimCitationInput[] {
  const snapshotsById = new Map(
    args.snapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  return args.claims.map((claim) => {
    const snapshot = snapshotsById.get(claim.sourceCandidateId);
    if (snapshot === undefined) {
      throw new Error(
        `Validated claim references a missing snapshot: ${claim.sourceCandidateId}`,
      );
    }
    const sourceText = `${snapshot.articleTitle} ${snapshot.articleDescription} ${snapshot.articleText}`;
    const coverage = lexicalEvidenceCoverage(claim.claim, sourceText);
    const unsupported = unsupportedVerifiableTokens(claim.claim, sourceText);
    const supportScore = Math.max(
      0,
      Math.min(100, Math.round(coverage * 100) - unsupported.length * 25),
    );
    const supportStatus =
      unsupported.length > 0
        ? ("unsupported" as const)
        : coverage >= MIN_SUPPORTED_CLAIM_COVERAGE
          ? ("supported" as const)
          : supportScore > 0 || claim.kind === "analysis"
            ? ("partial" as const)
            : ("unsupported" as const);
    const snapshotHash = deterministicForumClaimHash(
      JSON.stringify({
        id: snapshot.id,
        sourceKey: snapshot.sourceKey,
        url: snapshot.url,
        articleTitle: snapshot.articleTitle,
        articleDescription: snapshot.articleDescription,
        articleText: snapshot.articleText,
      }),
    );
    return {
      claimText: claim.claim,
      claimHash: deterministicForumClaimHash(claim.claim),
      ...resolveForumClaimBodySpan(args.body, claim.claim),
      sourceCandidateId: snapshot.id,
      sourceCandidateKey: snapshot.sourceKey,
      sourceUrl: snapshot.url,
      snapshotHash,
      snapshotVersion: FORUM_AGENT_CLAIM_SNAPSHOT_VERSION,
      kind: claim.kind,
      confidence: claim.confidence,
      supportStatus,
      supportScore,
    };
  });
}
