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
  "inlinecode",
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

// Keep this allowlist aligned with components/forum/forum-bbcode-model.ts.
// Unsupported paired tags are likely attempted markup; a lone [citation] or
// array index remains ordinary text. Empty [li] markers are handled by the
// existing mechanical repair, but populated [li] pairs are not renderer tags.
const SUPPORTED_FORUM_PUBLICATION_TAGS = new Set<string>([
  ...BALANCED_FORUM_TAGS,
  "*",
  "br",
  "center",
  "hr",
  "img",
  "kbd",
  "mark",
  "math",
  "step",
]);

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

  // Empty MyBB list items appear in several equivalent shapes depending on
  // the model: a bare opening marker, an explicitly closed [li][/li], or an
  // explicitly closed [*][/*]. None carries content, so removing them is a
  // lossless mechanical repair while populated items remain untouched.
  repaired = repaired
    .replace(/\[li\]\s*\[\/li\]/gi, "")
    .replace(/\[\*\]\s*\[\/\*\]/gi, "")
    .replace(
      /\[(?:\*|li)\](?:\s*\[\/(?:\*|li)\])?(?=\s*(?:\[(?:\*|li)\]|\[\/list\]))/gi,
      "",
    );

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

export type ForumPublicationValidationOptions = {
  /** Only set for an attribution footer just appended by the trusted finalizer. */
  trustedSourceFooter?: boolean;
};

export function validateForumAgentMarkup(
  body: string,
  options: ForumPublicationValidationOptions = {},
): ForumMarkupValidation {
  const feedback: string[] = [];
  const withoutCodeContents = maskForumCode(body);
  const unsupportedPairs = new Set<string>();
  for (const opening of withoutCodeContents.matchAll(
    /\[([a-z][a-z0-9_-]*)(?:=[^\]]*)?\]/gi,
  )) {
    const tag = opening[1]!.toLowerCase();
    if (SUPPORTED_FORUM_PUBLICATION_TAGS.has(tag)) continue;
    const afterOpening = withoutCodeContents.slice(
      (opening.index ?? 0) + opening[0].length,
    );
    if (new RegExp(`\\[\\/${tag}\\]`, "i").test(afterOpening))
      unsupportedPairs.add(tag);
  }
  for (const tag of unsupportedPairs)
    feedback.push(
      `Replace unsupported paired [${tag}] markup with supported BBCode or plain prose`,
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
    if (validRows.length !== rows.length) {
      feedback.push("Complete every table row and remove empty cells");
    }
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
      if (validRows.length !== rows.length) {
        feedback.push(`Complete every [${tag}] row and remove empty columns`);
      }
      if (validRows.length < requirements.rows) {
        feedback.push(
          `[${tag}] needs at least ${requirements.rows} complete ${
            requirements.rows === 1 ? "row" : "rows"
          } with ${requirements.columns} columns`,
        );
      }
    }
  }

  feedback.push(...validateForumContentCompleteness(body, options).feedback);

  return {
    feedback: [...new Set(feedback)],
    structuredBlockCount,
    structuredRowCount,
    valid: feedback.length === 0,
  };
}

/** A writing classification, never proof that a conclusion or capability is true. */
export function forumStatementIsQualifiedInference(statement: string) {
  const text = plainForumText(statement).trim();
  return /^(?:this (?:suggests|may suggest|could suggest)|my interpretation (?:is|would be)|a (?:reasonable|possible) (?:implication|interpretation) (?:is|would be)|(?:for|before|when)\b[^.!?]{0,100},\s*(?:consider|compare|check|inspect|test|keep|try)|(?:consider|compare|check|inspect|test|keep|try)\b)/i.test(
    text,
  );
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
            statement.split(/\s+/).length >= 3 &&
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

export type ForumContentIssue = {
  code:
    | "empty_section"
    | "empty_callout"
    | "bare_step"
    | "declared_count_mismatch"
    | "missing_promised_content"
    | "unfinished_transition"
    | "unresolved_pointer"
    | "source_topic_mismatch"
    | "board_topic_mismatch";
  message: string;
};

/** Shape checks only. A complete body is not necessarily accurate or useful. */
export function validateForumContentCompleteness(
  body: string,
  options: ForumPublicationValidationOptions & { title?: string } = {},
) {
  const issues: ForumContentIssue[] = [];
  const maskedBody = maskForumCode(body);
  // Initial model drafts are untrusted: a heading cannot grant permission to
  // omit the text after it. Only the finalizer's caller may identify a trusted
  // appended footer. Use the last marker so an earlier forged marker cannot
  // conceal defects in the authored body before the actual appended footer.
  const footers = options.trustedSourceFooter
    ? [
        ...maskedBody.matchAll(
          /\n[ \t]*\[b\]Sources and further reading\[\/b\]/gi,
        ),
      ]
    : [];
  const footerStart = footers.at(-1)?.index;
  const withoutCode =
    footerStart === undefined ? maskedBody : maskedBody.slice(0, footerStart);
  const plain = plainCompletenessText(withoutCode);
  const add = (code: ForumContentIssue["code"], message: string) => {
    if (
      !issues.some((issue) => issue.code === code && issue.message === message)
    ) {
      issues.push({ code, message });
    }
  };

  const headings = [
    ...withoutCode.matchAll(/\[h([23])\]([\s\S]*?)\[\/h\1\]/gi),
  ];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const end = (heading.index ?? 0) + heading[0].length;
    // A child heading may organize a parent section without intervening prose.
    const next = headings[index + 1];
    const contents = withoutCode.slice(end, next?.index ?? withoutCode.length);
    if (!hasCompletenessContent(heading[2] ?? "")) {
      add("empty_section", "Remove empty heading labels");
    } else if (
      !hasCompletenessContent(contents) &&
      !(heading[1] === "2" && next?.[1] === "3")
    ) {
      add(
        "empty_section",
        `Complete or remove the empty section: ${plainCompletenessText(heading[2] ?? "")}`,
      );
    }
  }

  for (const block of withoutCode.matchAll(
    /\[(note|warning|quote|spoiler)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/gi,
  )) {
    if (!hasCompletenessContent(block[2] ?? "")) {
      add(
        "empty_callout",
        `Complete or remove the empty [${block[1]?.toLowerCase()}] block`,
      );
    }
  }

  if (/^\s*(?:\d{1,2}[.)]|step\s+\d{1,2}[:.)-]?)\s*$/im.test(withoutCode)) {
    add("bare_step", "Complete or remove bare numbered steps");
  }

  // Only count a visible adjacent enumeration, not any occurrence of a number
  // in prose, a citation, a version, or a code sample.
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const declaration =
    /\b(?:the\s+following\s+|these\s+|(?:check|verify|test|follow|consider|need|requires?|include|includes)\s+(?:the\s+)?|^)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+(?:[a-z-]+\s+){0,3}(steps?|checks?|properties|requirements?|prerequisites?|items?|options?|points?|goals?|conditions?)\b[^\n.!?]*:?\s*\n/gim;
  for (const match of withoutCode.matchAll(declaration)) {
    const expected =
      countWords[match[1]?.toLowerCase() ?? ""] ?? Number(match[1]);
    const rest = withoutCode.slice((match.index ?? 0) + match[0].length);
    const itemCount = adjacentEnumerationCount(rest);
    if (itemCount > 0 && itemCount !== expected) {
      add(
        "declared_count_mismatch",
        `Declared ${expected} ${match[2]} but the adjacent list contains ${itemCount}`,
      );
    }
  }

  if (
    /\b(?:comparison\s+)?table\s+(?:below|follows)|\b(?:the\s+)?following\s+(?:comparison\s+)?table|\b(?:my|our|this)\s+(?:comparison\s+)?table\s+(?:shows|lists)|\bhere\s+is\s+(?:a|the)\s+(?:comparison\s+)?table/i.test(
      plain,
    ) &&
    !/\[(?:table|decision|chart|riskmap)(?:=|\])/i.test(withoutCode)
  ) {
    add(
      "missing_promised_content",
      "Provide the promised table or remove the reference to it",
    );
  }
  if (
    /\b(?:the\s+)?(?:code|snippet|command|script)\s+(?:below|follows)|\b(?:run|use|paste)\s+(?:the\s+)?following\s+(?:code|snippet|command|script)\b/i.test(
      plain,
    ) &&
    !/\[code(?:=|\])|```|`[^`\n]+`/i.test(body)
  ) {
    add(
      "missing_promised_content",
      "Provide the promised code or command, or remove the reference to it",
    );
  }
  if (
    /(?:\b(?:such as|including|as follows|for example|the following|because|therefore|which means|so that)|\b(?:fallback|prerequisites?|requirements?|steps?|options?)\s*:)\s*[.:—-]?\s*$/i.test(
      plain,
    )
  ) {
    add(
      "unfinished_transition",
      "Finish the trailing transition or remove the unfinished promise",
    );
  }
  if (
    /^(?:these|those)\s+(?:two|three|four|five|\d+)\s+(?:goals|options|requirements|conditions)\b/i.test(
      plain,
    ) &&
    !/\b(?:goals|options|requirements|conditions)\b/i.test(options.title ?? "")
  ) {
    add(
      "unresolved_pointer",
      "Introduce the goals or requirements before referring to them",
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    feedback: issues.map((issue) => issue.message),
  };
}

function maskForumCode(body: string) {
  return body.replace(
    /\[(code|inlinecode)(?:=[^\]]*)?\][\s\S]*?\[\/\1\]|```[\s\S]*?```|`[^`\n]+`/gi,
    "[code]code sample[/code]",
  );
}
function hasCompletenessContent(value: string) {
  return (
    plainCompletenessText(value).length > 0 ||
    /\[img(?:=[^\]]*)?\][\s\S]+?\[\/img\]/i.test(value)
  );
}
function plainCompletenessText(value: string) {
  return value
    .replace(
      /\[\/?(?:b|i|u|s|url|img|video|youtube|size|color|align|center|left|right|h2|h3|code|inlinecode|note|warning|quote|spoiler|list|li|\*|table|thead|tbody|tfoot|tr|th|td|chart|decision|riskmap|sourcecards|steps|timeline)(?:=[^\]]*)?\]/gi,
      " ",
    )
    .replace(/[\t ]+/g, " ")
    .trim();
}

function adjacentEnumerationCount(value: string) {
  const rest = value.trimStart();
  if (/^\[list(?:=[^\]]*)?\]/i.test(rest)) {
    let depth = 0;
    let items = 0;
    for (const token of rest.matchAll(
      /\[list(?:=[^\]]*)?\]|\[\/list\]|\[(?:\*|li)\]/gi,
    )) {
      if (/^\[list/i.test(token[0])) depth += 1;
      else if (/^\[\/list/i.test(token[0])) {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1) items += 1;
    }
    return items;
  }
  const markers = /^([\t ]*)(?:\d{1,2}[.)]|[-•])\s+\S/;
  const lines = rest.split("\n");
  const first = lines[0]?.match(markers);
  if (!first) return 0;
  let items = 0;
  let previousBlank = false;
  for (const line of lines) {
    if (!line.trim()) {
      previousBlank = true;
      continue;
    }
    const marker = line.match(markers);
    if (marker && marker[1]?.length === first[1]?.length) items += 1;
    else if (previousBlank && !/^\s+/.test(line)) break;
    previousBlank = false;
  }
  return items;
}
