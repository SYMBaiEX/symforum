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
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
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

const REPAIRABLE_STRUCTURED_TAGS = [
  "chart",
  "decision",
  "riskmap",
  "sourcecards",
  "steps",
  "table",
  "timeline",
] as const;

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
  let repaired = body;
  for (const tag of REPAIRABLE_STRUCTURED_TAGS) {
    const openingCount = countMatches(
      repaired,
      new RegExp(`\\[${tag}(?:=[^\\]]*)?\\]`, "gi"),
    );
    const closingCount = countMatches(
      repaired,
      new RegExp(`\\[\\/${tag}\\]`, "gi"),
    );
    if (openingCount === 1 && closingCount === 0) {
      repaired = `${repaired.trimEnd()}\n[/${tag}]`;
    }
  }

  const tableRowOpenings = countMatches(repaired, /\[tr\]/gi);
  const tableRowClosings = countMatches(repaired, /\[\/tr\]/gi);
  if (tableRowOpenings === tableRowClosings + 1) {
    repaired = repaired.replace(
      /\[\/table\](?![\s\S]*\[\/table\])/i,
      "[/tr]\n[/table]",
    );
  }

  return repaired.replace(
    /\[(th|td)\]((?:(?!\[\/?(?:th|td|tr|table)(?:=[^\]]*)?\])[\s\S])*?)(?=\[(?:th|td)\]|\[\/tr\]|\[\/table\])/gi,
    (_match, tag: string, contents: string) =>
      `[${tag.toLowerCase()}]${contents.trimEnd()}[/${tag.toLowerCase()}]`,
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
  const numericMatches = value.match(
    /\b(?:cve-\d{4}-\d+|v?\d+(?:\.\d+){1,3}|\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|×|kb|mb|gb|tb|ms|s|sec(?:onds?)?|min(?:utes?)?|hours?|days?|weeks?|months?|years?|tokens?|parameters?|requests?|users?|models?|points?|btc|usd|dollars?|million|billion|trillion))?)(?![a-z0-9])/gi,
  );
  const wordNumberMatches = value.match(
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]?(?:percent|kb|mb|gb|tb|milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?|tokens?|parameters?|requests?|users?|models?|points?|btc|usd|dollars?|million|billion|trillion)\b/gi,
  );
  return [
    ...new Set([
      ...(numericMatches ?? []).map(normalizeEvidenceToken),
      ...(wordNumberMatches ?? []).map((match) =>
        normalizeEvidenceToken(match).replace(/-/g, " "),
      ),
    ]),
  ];
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

  const emptyListItems = [
    ...withoutCodeContents.matchAll(
      /\[(?:\*|li)\]([\s\S]*?)(?=\[(?:\*|li)\]|\[\/list\])/gi,
    ),
  ].filter((item) => plainForumText(item[1] ?? "").length === 0);
  if (emptyListItems.length > 0) {
    feedback.push("Remove empty list items");
  }

  const danglingEnumeration = plainForumText(withoutCodeContents).match(
    /\b(?:the|this)\s+(first|second|third)\s+(?:is|was|means?|covers?)\b/i,
  );
  if (danglingEnumeration) {
    const ordinal = danglingEnumeration[1]?.toLowerCase();
    const hasNext =
      ordinal === "first"
        ? /\b(?:the|this)\s+second\b/i.test(plainForumText(withoutCodeContents))
        : ordinal === "second"
          ? /\b(?:the|this)\s+third\b/i.test(
              plainForumText(withoutCodeContents),
            )
          : true;
    if (!hasNext) {
      feedback.push("Complete or rewrite dangling numbered points");
    }
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
  const separatedRows = body
    .replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, " ")
    .replace(/\[h[23]\][\s\S]*?\[\/h[23]\]/gi, "\n\n")
    .replace(
      /\[(chart|decision|riskmap|sourcecards|steps|timeline)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/gi,
      (_block, _tag: string, rows: string) =>
        `\n\n${rows
          .split(/\r?\n/)
          .map((row) => row.trim())
          .filter(Boolean)
          .join("\n\n")}\n\n`,
    )
    .replace(
      /\[table(?:=[^\]]*)?\]([\s\S]*?)\[\/table\]/gi,
      (_table, rows: string) =>
        `\n\n${[...rows.matchAll(/\[tr\]([\s\S]*?)\[\/tr\]/gi)]
          .map((row) => row[1]?.trim() ?? "")
          .filter(Boolean)
          .join("\n\n")}\n\n`,
    );
  return [
    ...new Set(
      separatedRows
        .split(/(?<=[.!?])\s+|\n{2,}/)
        .map((statement) => plainForumText(statement))
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
  if (token.includes("-")) variants.add(token.replace(/-/g, " "));
  if (/^v\d/.test(token)) variants.add(token.slice(1));
  if (/s\b/.test(token)) variants.add(token.replace(/s\b/, ""));
  return [...variants];
}

function normalizeEvidenceToken(value: string) {
  return value.toLowerCase().replaceAll(",", "").replace(/\s+/g, " ").trim();
}

function normalizeEvidenceText(value: string) {
  return value
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}
