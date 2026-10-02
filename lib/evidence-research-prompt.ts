import {
  lexicalEvidenceCoverage,
  significantTokens,
  unsupportedVerifiableTokens,
} from "./editorial-quality";

export const MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS = 2_400;
const MIN_EVIDENCE_RESEARCH_CITATION_COVERAGE = 0.45;

export type EvidenceResearchPromptSource = {
  title: string;
  excerpt: string;
  canonicalUrl: string;
};

const QUERY_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "among",
  "been",
  "before",
  "being",
  "could",
  "does",
  "from",
  "have",
  "into",
  "more",
  "most",
  "other",
  "over",
  "same",
  "some",
  "than",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "using",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
]);

/** Select query-matching source sentences while retaining their original order. */
export function compactEvidenceResearchExcerpt(
  query: string,
  excerpt: string,
  maximumCharacters = MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS,
) {
  const limit = Number.isSafeInteger(maximumCharacters)
    ? Math.max(1, maximumCharacters)
    : MAX_EVIDENCE_RESEARCH_EXCERPT_CHARACTERS;
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;

  const queryTerms = new Set(
    evidenceWords(query).filter(
      (term) =>
        term.length >= 3 && !QUERY_STOP_WORDS.has(term) && !/^\d+$/.test(term),
    ),
  );
  if (queryTerms.size === 0) return truncateAtWordBoundary(normalized, limit);

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((sentence) => sentence.text.length > 0);
  const sentenceTerms = sentences.map(
    (sentence) => new Set(evidenceWords(sentence.text)),
  );
  const selected = new Set<number>();
  const coveredTerms = new Set<string>();
  let usedCharacters = 0;

  while (usedCharacters < limit) {
    let bestIndex = -1;
    let bestNewTerms = 0;
    let bestTotalTerms = 0;
    for (let index = 0; index < sentences.length; index += 1) {
      if (selected.has(index)) continue;
      const sentence = sentences[index]!;
      const separatorLength = selected.size === 0 ? 0 : 1;
      const remaining = limit - usedCharacters - separatorLength;
      if (remaining <= 0) continue;

      let newTerms = 0;
      let totalTerms = 0;
      for (const term of queryTerms) {
        if (!sentenceTerms[index]!.has(term)) continue;
        totalTerms += 1;
        if (!coveredTerms.has(term)) newTerms += 1;
      }
      if (
        newTerms > bestNewTerms ||
        (newTerms === bestNewTerms && totalTerms > bestTotalTerms)
      ) {
        bestIndex = index;
        bestNewTerms = newTerms;
        bestTotalTerms = totalTerms;
      }
    }

    if (bestIndex < 0 || bestTotalTerms === 0) break;
    const separatorLength = selected.size === 0 ? 0 : 1;
    const remaining = limit - usedCharacters - separatorLength;
    const sentence = sentences[bestIndex]!;
    const selectedText =
      sentence.text.length <= remaining
        ? sentence.text
        : excerptAroundQueryTerms(sentence.text, queryTerms, remaining);
    if (!selectedText) break;

    selected.add(bestIndex);
    usedCharacters += selectedText.length + separatorLength;
    const selectedTerms = new Set(evidenceWords(selectedText));
    for (const term of queryTerms) {
      if (selectedTerms.has(term)) coveredTerms.add(term);
    }
    sentences[bestIndex] = { ...sentence, text: selectedText };
  }

  if (selected.size === 0) return truncateAtWordBoundary(normalized, limit);
  return sentences
    .filter((sentence) => selected.has(sentence.index))
    .map((sentence) => sentence.text)
    .join(" ");
}

export function compactEvidenceResearchSources(
  query: string,
  sources: readonly EvidenceResearchPromptSource[],
) {
  return sources.map((source) => ({
    ...source,
    excerpt: compactEvidenceResearchExcerpt(query, source.excerpt),
  }));
}

export function buildEvidenceResearchPrompt(
  query: string,
  sources: readonly EvidenceResearchPromptSource[],
) {
  return `Write a concise cited Markdown evidence brief for the query ${JSON.stringify(query)}. Use only the supplied source excerpts. Do not infer claims not present in them. Cite each factual paragraph with one or more source numbers like [1].\n\nSources:\n${sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}\n${source.excerpt}\n${source.canonicalUrl}`,
    )
    .join("\n\n")}`;
}

export function buildExtractiveEvidenceDigest(
  query: string,
  sources: readonly EvidenceResearchPromptSource[],
) {
  const citations = sources
    .map(
      (source, index) =>
        `- [${index + 1}] ${source.title}: ${source.excerpt} (${source.canonicalUrl})`,
    )
    .join("\n");
  return `# Evidence digest\n\nQuery: ${query}\n\nRouting unavailable or model citations failed validation; this is a deterministic extractive digest, not generated analysis.\n\n${citations}`;
}

/** Validate citation numbering and require every non-heading paragraph to cite a source. */
export function hasCompleteEvidenceResearchCitations(
  markdown: string,
  sourceCount: number,
) {
  const references = [...markdown.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );
  if (
    references.length === 0 ||
    references.some(
      (reference) =>
        !Number.isSafeInteger(reference) ||
        reference < 1 ||
        reference > sourceCount,
    )
  ) {
    return false;
  }

  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.every((paragraph) => {
    const content = paragraph
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s/.test(line));
    return content.length === 0 || content.some((line) => /\[\d+\]/.test(line));
  });
}

/**
 * Require every cited source to lexically support the paragraph or bullet it
 * annotates, and reject verifiable numeric details absent from that source.
 * This is a deterministic relevance gate, not a semantic entailment proof.
 */
export function hasGroundedEvidenceResearchCitations(
  markdown: string,
  sources: readonly EvidenceResearchPromptSource[],
) {
  if (!hasCompleteEvidenceResearchCitations(markdown, sources.length)) {
    return false;
  }

  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^#{1,6}\s/.test(line)),
    )
    .filter((lines) => lines.length > 0)
    .every((lines) => {
      const claimGroups =
        lines.length > 1 && lines.every((line) => /^[-*+]\s+/.test(line))
          ? lines
          : [lines.join(" ")];

      return claimGroups.every((group) => {
        const references = [...group.matchAll(/\[(\d+)\]/g)].map((match) =>
          Number(match[1]),
        );
        if (references.length === 0) return false;

        const claim = group
          .replace(/\[(\d+)\]/g, " ")
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/[`*_>#|]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const claimTokens = significantTokens(claim).filter(
          (token) => token.length >= 4 && !/^\d+$/.test(token),
        );
        if (claimTokens.length === 0) return false;

        return references.every((reference) => {
          const source = sources[reference - 1];
          if (source === undefined) return false;
          const sourceText = `${source.title} ${source.excerpt}`;
          return (
            unsupportedVerifiableTokens(claim, sourceText).length === 0 &&
            lexicalEvidenceCoverage(claim, sourceText) >=
              MIN_EVIDENCE_RESEARCH_CITATION_COVERAGE
          );
        });
      });
    });
}

function truncateAtWordBoundary(value: string, limit: number) {
  const truncated = value.slice(0, limit);
  const boundary = truncated.lastIndexOf(" ");
  return (
    boundary >= limit * 0.7 ? truncated.slice(0, boundary) : truncated
  ).trim();
}

function evidenceWords(value: string) {
  return value.toLowerCase().match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? [];
}

function excerptAroundQueryTerms(
  value: string,
  queryTerms: ReadonlySet<string>,
  limit: number,
) {
  if (limit <= 0) return "";
  const lowerValue = value.toLowerCase();
  const firstMatch = [...queryTerms]
    .map((term) => lowerValue.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstMatch === undefined) return truncateAtWordBoundary(value, limit);

  const start = Math.max(
    0,
    Math.min(firstMatch - Math.floor(limit / 3), value.length - limit),
  );
  let excerpt = value.slice(start, start + limit).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (start + limit < value.length) excerpt = `${excerpt}…`;
  return excerpt.slice(0, limit).trim();
}
