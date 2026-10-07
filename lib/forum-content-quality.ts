import {
  lexicalSimilarity,
  significantTokens,
  type ForumContentIssue,
} from "./editorial-quality";
export {
  validateForumContentCompleteness,
  type ForumContentIssue,
} from "./editorial-quality";

export type ForumReadabilityIssue = {
  code: "long_prose_paragraph" | "readability_scan_limit";
  message: string;
  /** One-based ordinary prose paragraph; zero for the whole-body scan limit. */
  paragraph: number;
  wordCount: number;
  blocking: boolean;
};

const READABILITY_SCAN_LIMIT = 64_000;
const RECOMMENDED_PARAGRAPH_WORDS = 100;
const MAX_PARAGRAPH_WORDS = 120;

/** A bounded formatting check, not a score for usefulness or semantic quality.
 * Only identify a source footer when it was just appended by the trusted
 * finalizer; draft headings cannot exempt authored text from this check.
 * Soft-wrapped prose is one paragraph; short posts need no prescribed structure.
 * Completeness and markup validation remain separate publication checks. */
export function assessForumReadability(
  body: string,
  options: { trustedSourceFooter?: boolean } = {},
) {
  const issues: ForumReadabilityIssue[] = [];
  if (body.length > READABILITY_SCAN_LIMIT) {
    issues.push({
      code: "readability_scan_limit",
      message: `The authored body exceeds the ${READABILITY_SCAN_LIMIT.toLocaleString("en-US")}-character readability scan limit; shorten or split it before publication`,
      paragraph: 0,
      wordCount: 0,
      blocking: true,
    });
    return {
      valid: false,
      issues,
      feedback: issues.map((issue) => issue.message),
      paragraphCount: 0,
      maxParagraphWords: 0,
      formattingOnly: true as const,
    };
  }

  // Scan length applies to the full body before excluding any trusted footer.
  // The last marker preserves all authored material after earlier fake markers.
  const footers = options.trustedSourceFooter
    ? [...body.matchAll(/\n[ \t]*\[b\]Sources and further reading\[\/b\]/gi)]
    : [];
  const footerStart = footers.at(-1)?.index;
  const paragraphs = readabilityProse(
    footerStart === undefined ? body : body.slice(0, footerStart),
  );
  let maxParagraphWords = 0;
  paragraphs.forEach((paragraph, index) => {
    const wordCount = plainText(paragraph).split(/\s+/).filter(Boolean).length;
    maxParagraphWords = Math.max(maxParagraphWords, wordCount);
    if (wordCount <= RECOMMENDED_PARAGRAPH_WORDS) return;
    const blocking = wordCount > MAX_PARAGRAPH_WORDS;
    issues.push({
      code: "long_prose_paragraph",
      message: `Paragraph ${index + 1} has ${wordCount} words. Split it at a natural change of thought into shorter paragraphs${blocking ? " before publication" : " for easier reading"}; retain the substance without adding unnecessary headings or lists`,
      paragraph: index + 1,
      wordCount,
      blocking,
    });
  });
  return {
    valid: !issues.some((issue) => issue.blocking),
    issues,
    feedback: issues.map((issue) => issue.message),
    paragraphCount: paragraphs.length,
    maxParagraphWords,
    formattingOnly: true as const,
  };
}

function readabilityProse(body: string) {
  // Only closed artifacts are masked, so an unfinished opener cannot conceal
  // a prose wall. Inline code contributes one token rather than its contents.
  let prose = maskReadabilityBlocks(body.replace(/\r\n?/g, "\n"))
    .replace(
      /(?:^|\n)[\t ]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[\t ]*\1[\t ]*(?=\n|$)/g,
      "\n\n",
    )
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, "\n\n")
    .replace(/`[^`\n]+`/g, " code ")
    .replace(/\[(?:\/?p|\/?h[1-6])\]/gi, "\n\n")
    // List contents are prose too: a long single bullet must not escape the
    // gate, while several short bullets are never summed into one paragraph.
    .replace(/\[\/?list(?:=[^\]]*)?\]|\[\*\]/gi, "\n\n")
    .replace(/\[br\]/gi, "\n");

  const lines = prose.split("\n");
  const normalized: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    // Genuine Markdown tables have a separator row; arbitrary prose containing
    // a pipe is still assessed. Each table is its own display artifact.
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
        lines[index + 1] ?? "",
      )
    ) {
      normalized.push("", "");
      index += 1;
      while ((lines[index + 1] ?? "").trim().includes("|")) index += 1;
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(line)) {
      normalized.push("", line.replace(/^\s{0,3}#{1,6}\s+/, ""), "");
      continue;
    }
    // Separate list entries while keeping their soft-wrapped continuation
    // prose together. A long single item can still receive split feedback.
    if (/^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line)) {
      normalized.push("", line.replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)/, ""));
      continue;
    }
    normalized.push(line);
  }
  prose = normalized.join("\n");
  return prose.split(/\n[\t ]*\n+/).filter((paragraph) => plainText(paragraph));
}

function maskReadabilityBlocks(body: string) {
  const tags = /\[(\/?)(code|math|latex|table|chart|steps|timeline|decision|riskmap|sourcecards)(?:=[^\]]*)?\]/gi;
  const stack: { tag: string; start: number }[] = [];
  const ranges: { start: number; end: number }[] = [];
  for (const match of body.matchAll(tags)) {
    const tag = (match[2] ?? "").toLowerCase();
    const top = stack[stack.length - 1];
    // Code and math may contain literal markup; only their closing tag matters.
    if (top && /^(?:code|math|latex)$/.test(top.tag) && tag !== top.tag)
      continue;
    if (!match[1]) {
      if (top && /^(?:code|math|latex)$/.test(top.tag)) continue;
      stack.push({ tag, start: match.index ?? 0 });
    } else if (top?.tag === tag) {
      stack.pop();
      if (stack.length === 0)
        ranges.push({ start: top.start, end: (match.index ?? 0) + match[0].length });
    }
  }
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += body.slice(cursor, range.start) + "\n\n";
    cursor = range.end;
  }
  return result + body.slice(cursor);
}

/** Distinguishes added structure from a table that merely repeats nearby prose.
 * This is a lexical screen, never evidence verification or a quality score. */
export function assessForumStructuredValue(body: string) {
  const blocks = [
    ...maskCode(body).matchAll(
      /\[(table|chart|decision|riskmap|sourcecards|steps|timeline)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/gi,
    ),
  ];
  const prose = maskCode(body).replace(
    /\[(table|chart|decision|riskmap|sourcecards|steps|timeline)(?:=[^\]]*)?\][\s\S]*?\[\/\1\]/gi,
    "\n",
  );
  const segments = plainText(prose)
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(Boolean);
  const rows: string[] = [];
  for (const block of blocks) {
    if (block[1]?.toLowerCase() === "table") {
      for (const row of (block[2] ?? "").matchAll(
        /\[tr\]([\s\S]*?)\[\/tr\]/gi,
      )) {
        if (/\[th\]/i.test(row[1] ?? "")) continue;
        const cells = [
          ...(row[1] ?? "").matchAll(/\[td\]([\s\S]*?)\[\/td\]/gi),
        ].map((cell) => plainText(cell[1] ?? ""));
        rows.push(
          cells.filter((cell) => !/^signal\s*\d+$/i.test(cell)).join(" "),
        );
      }
    } else {
      rows.push(
        ...(block[2] ?? "")
          .split("\n")
          .map((row) => plainText(row.replace(/^\s*signal\s*\d+\s*\|/i, "")))
          .filter(Boolean),
      );
    }
  }
  const repeatedRowCount = rows.filter(
    (row) =>
      significantTokens(row).length >= 3 &&
      segments.some((segment) => lexicalSimilarity(row, segment) >= 0.72),
  ).length;
  const informativeRowCount =
    rows.filter((row) => significantTokens(row).length >= 3).length -
    repeatedRowCount;
  return {
    blockCount: blocks.length,
    repeatedRowCount,
    informativeRowCount,
    addsInformation: informativeRowCount > 0,
  };
}

export type ForumContentFitInput = {
  title: string;
  body?: string;
  board: { slug: string; name: string; description?: string };
  sources: { title: string; text: string; url?: string }[];
};

const DOMAINS = {
  music:
    /\b(?:music|musician|album|vocals?|recording|producer|mixing|remix|rolling stones|todd edwards|guitar|band)\b/gi,
  gaming:
    /\b(?:games?|gaming|steam|proton|dlss|nintendo|playstation|xbox|unreal|unity|doom)\b/gi,
  software:
    /\b(?:copilot|pr review|pull requests?|code|coding|software|programming|github|debugger|compiler|sdk|api|metrics?)\b/gi,
  ai: /\b(?:ai|llm|artificial intelligence|training|inference|tokens?|models?|transformers?|neural|llama|lfm\d|autosynthdata)\b/gi,
  security:
    /\b(?:cve|exploit|vulnerability|vulnerabilities|netscaler|routeros|ransomware|malware|cisa)\b/gi,
  hardware:
    /\b(?:hardware|esp32|fpga|chip|silicon|raspberry pi|microcontroller|circuit|ram|gnss)\b/gi,
} as const;
type Domain = keyof typeof DOMAINS;
type Fit = "aligned" | "mismatch" | "uncertain" | "not_applicable";

function domains(value: string) {
  return (Object.entries(DOMAINS) as [Domain, RegExp][])
    .filter(([, pattern]) => [...value.matchAll(pattern)].length >= 2)
    .map(([domain]) => domain);
}
function incompatible(left: Domain[], right: Domain[]) {
  if (
    left.length === 0 ||
    right.length === 0 ||
    left.some((domain) => right.includes(domain))
  )
    return false;
  // Technical/musical crossover is legitimate (game engines, audio SDKs,
  // vision tools). Hard flags deliberately target the audited music/tech and
  // music/gaming swaps, rather than forcing every topic into one specialty.
  return (
    (left.every((domain) => domain === "music") &&
      right.every((domain) => domain !== "music" && domain !== "software")) ||
    (right.every((domain) => domain === "music") &&
      left.every((domain) => domain !== "music"))
  );
}

/** Conservative triage of obvious subject swaps. "aligned" describes lexical
 * topic overlap only: it does NOT establish truth, entailment, authority, or
 * source completeness. Uncertain cases require editorial review. */
export function assessForumContentFit(input: ForumContentFitInput) {
  const issues: ForumContentIssue[] = [];
  const subject = domains(input.title);
  let sourceFit: Fit =
    input.sources.length === 0 ? "not_applicable" : "uncertain";
  const sourceDomains = input.sources.map((source) =>
    domains(`${source.title}\n${source.text.slice(0, 1200)}`),
  );
  const topicTokens = significantTokens(input.title).filter(
    (token) =>
      ![
        "guide",
        "reading",
        "before",
        "trust",
        "actually",
        "practical",
        "review",
      ].includes(token),
  );
  if (
    input.sources.length > 0 &&
    sourceDomains.every((source) => incompatible(subject, source))
  ) {
    sourceFit = "mismatch";
    issues.push({
      code: "source_topic_mismatch",
      message:
        "The cited sources discuss a different subject from the proposed post; choose relevant evidence or rewrite the topic",
    });
  } else if (
    input.sources.some((source) => {
      const tokens = new Set(
        significantTokens(`${source.title}\n${source.text}`),
      );
      return topicTokens.filter((token) => tokens.has(token)).length >= 2;
    })
  ) {
    sourceFit = "aligned";
  }

  const boardText = `${input.board.slug.replaceAll("-", " ")} ${input.board.name}`;
  const boardDomain = domains(boardText);
  const bodySubject = domains(
    `${input.title}\n${plainText(input.body ?? "").slice(0, 500)}`,
  );
  let boardFit: Fit = "uncertain";
  if (/^(?:general|news|projects|research)$/.test(input.board.slug)) {
    boardFit = "not_applicable";
  } else if (incompatible(bodySubject, boardDomain)) {
    boardFit = "mismatch";
    issues.push({
      code: "board_topic_mismatch",
      message: `The topic is outside ${input.board.name}'s stated specialty; choose a fitting board`,
    });
  } else if (bodySubject.some((domain) => boardDomain.includes(domain))) {
    boardFit = "aligned";
  }
  return { sourceFit, boardFit, issues, lexicalOnly: true as const };
}

function maskCode(body: string) {
  return body.replace(
    /\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]|```[\s\S]*?```|`[^`\n]+`/gi,
    "[code]code sample[/code]",
  );
}
function plainText(value: string) {
  return value
    .replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}
