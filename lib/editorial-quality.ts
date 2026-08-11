const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "being",
  "could",
  "from",
  "have",
  "into",
  "just",
  "more",
  "news",
  "only",
  "other",
  "should",
  "than",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

export function significantTokens(value: string) {
  return [
    ...new Set(
      (value.toLowerCase().match(/[a-z0-9][a-z0-9.+_-]{2,}/g) ?? []).filter(
        (token) => !STOP_WORDS.has(token),
      ),
    ),
  ];
}

export function lexicalSimilarity(left: string, right: string) {
  const leftTokens = new Set(significantTokens(left));
  const rightTokens = new Set(significantTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

export function lexicalEvidenceCoverage(statement: string, source: string) {
  const statementTokens = significantTokens(statement).filter(
    (token) => token.length >= 4 && !/^\d+$/.test(token),
  );
  if (statementTokens.length === 0) return 1;
  const sourceTokens = new Set(significantTokens(source));
  const supported = statementTokens.filter((token) => sourceTokens.has(token));
  return supported.length / statementTokens.length;
}

export function extractVerifiableTokens(value: string) {
  const matches = value.match(
    /\b(?:cve-\d{4}-\d+|v?\d+(?:\.\d+){1,3}|\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|×|kb|mb|gb|tb|ms|s|sec(?:onds?)?|min(?:utes?)?|hours?|days?|weeks?|months?|years?|tokens?|parameters?|requests?|users?|models?|points?|btc|usd|dollars?|million|billion|trillion))?)(?![a-z0-9])/gi,
  );
  return [...new Set((matches ?? []).map(normalizeEvidenceToken))];
}

export function unsupportedVerifiableTokens(statement: string, source: string) {
  const normalizedSource = normalizeEvidenceText(source);
  return extractVerifiableTokens(statement).filter(
    (token) =>
      !evidenceTokenVariants(token).some((variant) =>
        normalizedSource.includes(variant),
      ),
  );
}

function evidenceTokenVariants(token: string) {
  const variants = new Set([token]);
  if (/^v\d/.test(token)) variants.add(token.slice(1));
  if (/s\b/.test(token)) variants.add(token.replace(/s\b/, ""));
  return [...variants];
}

function normalizeEvidenceToken(value: string) {
  return value.toLowerCase().replaceAll(",", "").replace(/\s+/g, " ").trim();
}

function normalizeEvidenceText(value: string) {
  return value.toLowerCase().replaceAll(",", "").replace(/\s+/g, " ");
}
