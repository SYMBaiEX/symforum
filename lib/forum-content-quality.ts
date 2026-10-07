import {
  lexicalSimilarity,
  significantTokens,
  type ForumContentIssue,
} from "./editorial-quality";
export {
  validateForumContentCompleteness,
  type ForumContentIssue,
} from "./editorial-quality";

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
