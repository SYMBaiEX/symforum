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

const BALANCED_FORUM_TAGS = [
  "b",
  "chart",
  "code",
  "color",
  "decision",
  "h2",
  "h3",
  "i",
  "list",
  "note",
  "quote",
  "riskmap",
  "s",
  "sourcecards",
  "spoiler",
  "steps",
  "table",
  "td",
  "th",
  "timeline",
  "tr",
  "u",
  "url",
  "warning",
] as const;

const STRUCTURED_FORUM_BLOCKS = {
  chart: { columns: 3, rows: 2 },
  decision: { columns: 3, rows: 2 },
  riskmap: { columns: 4, rows: 1 },
  sourcecards: { columns: 3, rows: 1 },
  steps: { columns: 3, rows: 2 },
  timeline: { columns: 3, rows: 2 },
} as const;

const GENERIC_RELATED_THREAD_TOKENS = new Set([
  "about",
  "agent",
  "agents",
  "forum",
  "github",
  "guide",
  "model",
  "models",
  "news",
  "release",
  "thread",
  "tool",
  "tools",
  "update",
]);

export type ForumMarkupValidation = {
  feedback: string[];
  structuredBlockCount: number;
  structuredRowCount: number;
  valid: boolean;
};

export function repairForumAgentMarkup(body: string) {
  return body.replace(
    /\[(th|td)\]((?:(?!\[\/?(?:th|td|tr|table)(?:=[^\]]*)?\])[\s\S])*?)(?=\[(?:th|td)\]|\[\/tr\]|\[\/table\])/gi,
    (_match, tag: string, contents: string) =>
      `[${tag.toLowerCase()}]${contents}[/${tag.toLowerCase()}]`,
  );
}

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

export function validateForumAgentMarkup(body: string): ForumMarkupValidation {
  const feedback: string[] = [];
  const withoutCodeContents = body.replace(
    /\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi,
    "[code][/code]",
  );

  if (/^\s{0,3}#{1,6}\s+\S/m.test(withoutCodeContents)) {
    feedback.push("Use BBCode headings instead of Markdown headings");
  }
  if (
    /^\s*\|?\s*:?-{3,}:?\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/m.test(
      withoutCodeContents,
    )
  ) {
    feedback.push("Use a BBCode table instead of a Markdown pipe table");
  }
  if (/<\/?[a-z][^>]*>/i.test(withoutCodeContents)) {
    feedback.push("Use BBCode instead of raw HTML");
  }

  for (const tag of BALANCED_FORUM_TAGS) {
    const openingCount = countMatches(
      withoutCodeContents,
      new RegExp(`\\[${tag}(?:=[^\\]]*)?\\]`, "gi"),
    );
    const closingCount = countMatches(
      withoutCodeContents,
      new RegExp(`\\[\\/${tag}\\]`, "gi"),
    );
    if (openingCount !== closingCount) {
      feedback.push(
        `Balance every [${tag}] block (${openingCount} open, ${closingCount} closed)`,
      );
    }
  }

  let structuredBlockCount = 0;
  let structuredRowCount = 0;

  const tableBlocks = [
    ...withoutCodeContents.matchAll(/\[table\]([\s\S]*?)\[\/table\]/gi),
  ];
  for (const block of tableBlocks) {
    structuredBlockCount += 1;
    const rows = [...(block[1] ?? "").matchAll(/\[tr\]([\s\S]*?)\[\/tr\]/gi)];
    const validRows = rows.filter((row) => {
      const cells = [
        ...(row[1] ?? "").matchAll(/\[(?:th|td)\]([\s\S]*?)\[\/(?:th|td)\]/gi),
      ];
      return (
        cells.length >= 2 &&
        cells.every((cell) => plainForumText(cell[1] ?? "").length > 0)
      );
    });
    structuredRowCount += validRows.length;
    const hasHeader = rows.some((row) =>
      /\[th\][\s\S]*?\[\/th\]/i.test(row[1] ?? ""),
    );
    if (validRows.length < 2 || !hasHeader) {
      feedback.push(
        "Each [table] needs a header row and at least one complete data row",
      );
    }
  }

  for (const [tag, requirements] of Object.entries(STRUCTURED_FORUM_BLOCKS)) {
    const blocks = [
      ...withoutCodeContents.matchAll(
        new RegExp(
          `\\[${tag}(?:=[^\\]]*)?\\]([\\s\\S]*?)\\[\\/${tag}\\]`,
          "gi",
        ),
      ),
    ];
    for (const block of blocks) {
      structuredBlockCount += 1;
      const rows = (block[1] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const validRows = rows.filter((row) => {
        const columns = row.split("|").map((column) => plainForumText(column));
        return (
          columns.length >= requirements.columns &&
          columns.slice(0, requirements.columns).every(Boolean)
        );
      });
      structuredRowCount += validRows.length;
      if (validRows.length < requirements.rows) {
        feedback.push(
          `[${tag}] needs at least ${requirements.rows} complete ${
            requirements.rows === 1 ? "row" : "rows"
          } with ${requirements.columns} columns`,
        );
      }
    }
  }

  if (structuredBlockCount === 0) {
    feedback.push("Include one complete structured evidence block");
  }

  return {
    feedback: [...new Set(feedback)],
    structuredBlockCount,
    structuredRowCount,
    valid: feedback.length === 0,
  };
}

export function forumBodyFactualStatements(body: string) {
  const plain = plainForumText(
    body
      .replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, " ")
      .replace(/\[h[23]\][\s\S]*?\[\/h[23]\]/gi, "\n\n")
      .replace(
        /\[(?:chart|decision|riskmap|sourcecards|steps|timeline)(?:=[^\]]*)?\]/gi,
        "\n",
      )
      .replace(
        /\[\/(?:chart|decision|riskmap|sourcecards|steps|timeline)\]/gi,
        "\n",
      ),
  );
  return [
    ...new Set(
      plain
        .split(/(?<=[.!?])\s+|\n{2,}/)
        .map((statement) => statement.replace(/\s+/g, " ").trim())
        .filter(
          (statement) =>
            statement.split(/\s+/).length >= 7 &&
            !statement.endsWith("?") &&
            (extractVerifiableTokens(statement).length > 0 ||
              /\b(?:adds?|allows?|available|can|deprecat(?:e|es|ed)|has|have|includes?|introduc(?:e|es|ed)|is|are|means?|offers?|requires?|ships?|supports?|will)\b/i.test(
                statement,
              )),
        ),
    ),
  ];
}

export function forumQuestionSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeQuestion(left);
  const normalizedRight = normalizeQuestion(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 1;
  }
  return lexicalSimilarity(normalizedLeft, normalizedRight);
}

export function forumBodyQuestions(body: string) {
  const plain = body
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/[\t ]+/g, " ");
  return (
    plain.match(/[^?.!\n]{10,}\?/g)?.map((question) => question.trim()) ?? []
  );
}

export function isMeaningfullyRelatedForumThread(
  subjectTitle: string,
  candidateTitle: string,
) {
  const subjectTokens = significantTokens(subjectTitle).filter(
    (token) => !GENERIC_RELATED_THREAD_TOKENS.has(token),
  );
  const candidateTokens = new Set(
    significantTokens(candidateTitle).filter(
      (token) => !GENERIC_RELATED_THREAD_TOKENS.has(token),
    ),
  );
  const shared = subjectTokens.filter((token) => candidateTokens.has(token));
  return (
    shared.length >= 2 && lexicalSimilarity(subjectTitle, candidateTitle) >= 0.2
  );
}

function plainForumText(value: string) {
  return value
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQuestion(value: string) {
  return plainForumText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
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
