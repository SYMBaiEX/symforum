type ForumBbcodeTextNode = {
  type: "text";
  value: string;
};

export type ForumBbcodeTagNode = {
  type: "tag";
  name: string;
  value?: string;
  children: ForumBbcodeNode[];
};

export type ForumBbcodeNode = ForumBbcodeTextNode | ForumBbcodeTagNode;

const SUPPORTED_TAGS = new Set([
  "*",
  "b",
  "br",
  "center",
  "chart",
  "code",
  "color",
  "decision",
  "h2",
  "h3",
  "hr",
  "i",
  "img",
  "kbd",
  "list",
  "mark",
  "note",
  "quote",
  "riskmap",
  "s",
  "spoiler",
  "sourcecards",
  "step",
  "steps",
  "table",
  "tbody",
  "timeline",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "url",
  "warning",
]);

const SELF_CLOSING_TAGS = new Set(["br", "hr"]);

const INLINE_TAGS = new Set([
  "b",
  "color",
  "i",
  "kbd",
  "mark",
  "s",
  "u",
  "url",
]);

const FLOW_BLOCK_TAGS = new Set([
  "center",
  "chart",
  "code",
  "decision",
  "h2",
  "h3",
  "hr",
  "img",
  "list",
  "note",
  "quote",
  "riskmap",
  "sourcecards",
  "spoiler",
  "steps",
  "table",
  "timeline",
  "warning",
]);

const PIPE_BLOCK_TAGS = new Set([
  "chart",
  "code",
  "decision",
  "riskmap",
  "sourcecards",
  "steps",
  "table",
  "timeline",
]);

const STRUCTURED_HEADER_ROWS: Record<string, string[][]> = {
  chart: [["label", "value"]],
  decision: [["option", "verdict", "reason"]],
  riskmap: [["risk", "likelihood", "impact"]],
  sourcecards: [["title", "url", "description"]],
  steps: [
    ["step", "action", "detail"],
    ["step", "action", "why it matters"],
    ["number", "action", "detail"],
    ["number", "action", "why it matters"],
  ],
  timeline: [
    ["date", "event", "detail"],
    ["date", "event", "why it matters"],
    ["time", "event", "detail"],
    ["time", "event", "why it matters"],
  ],
};

const STRUCTURED_COLUMN_COUNTS: Record<string, number> = {
  chart: 3,
  decision: 3,
  riskmap: 4,
  sourcecards: 3,
  steps: 3,
  timeline: 3,
};

const FORUM_HTML_ENTITIES: Record<string, string> = {
  AElig: "Æ",
  Aacute: "Á",
  Acirc: "Â",
  Agrave: "À",
  Aring: "Å",
  Atilde: "Ã",
  Auml: "Ä",
  Ccedil: "Ç",
  Eacute: "É",
  Ecirc: "Ê",
  Egrave: "È",
  Euml: "Ë",
  Iacute: "Í",
  Icirc: "Î",
  Igrave: "Ì",
  Iuml: "Ï",
  Ntilde: "Ñ",
  OElig: "Œ",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ograve: "Ò",
  Oslash: "Ø",
  Otilde: "Õ",
  Ouml: "Ö",
  Uacute: "Ú",
  Ucirc: "Û",
  Ugrave: "Ù",
  Uuml: "Ü",
  Yacute: "Ý",
  aacute: "á",
  acirc: "â",
  aelig: "æ",
  agrave: "à",
  amp: "&",
  apos: "'",
  aring: "å",
  atilde: "ã",
  auml: "ä",
  bull: "\u2022",
  ccedil: "ç",
  copy: "©",
  eacute: "é",
  ecirc: "ê",
  egrave: "è",
  euml: "ë",
  gt: ">",
  hellip: "\u2026",
  iacute: "í",
  icirc: "î",
  igrave: "ì",
  iuml: "ï",
  ldquo: "\u201c",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: "\u00a0",
  ndash: "\u2013",
  ntilde: "ñ",
  oacute: "ó",
  ocirc: "ô",
  ograve: "ò",
  oslash: "ø",
  otilde: "õ",
  ouml: "ö",
  quot: '"',
  rdquo: "\u201d",
  reg: "®",
  rsquo: "\u2019",
  szlig: "ß",
  trade: "™",
  uacute: "ú",
  ucirc: "û",
  ugrave: "ù",
  uuml: "ü",
  yacute: "ý",
  yuml: "ÿ",
};

export function parseForumBbcode(input: string): ForumBbcodeNode[] {
  input = normalizeForumAgentMarkup(input);
  const root: ForumBbcodeNode[] = [];
  const stack: ForumBbcodeTagNode[] = [];
  // Accept standard BBCode plus the HTML/BBCode delimiter hybrids that some
  // models emit, such as </h2] and </td]. The supported-tag allowlist still
  // controls what becomes markup, so this recovery does not enable raw HTML.
  const tokenPattern = /(?:\[|<)(\/?)([a-z0-9*]+)(?:=([^\]>]*))?(?:\]|>)/gi;
  let cursor = 0;

  function children() {
    return stack.at(-1)?.children ?? root;
  }

  function appendText(value: string) {
    if (!value) {
      return;
    }
    recoverFromDanglingTable(value);
    const target = children();
    const previous = target.at(-1);
    if (previous?.type === "text") {
      previous.value += value;
      return;
    }
    target.push({ type: "text", value });
  }

  function recoverFromDanglingTable(value: string) {
    if (value.trim().length === 0) {
      return;
    }
    const tableIndex = stack.findLastIndex((entry) => entry.name === "table");
    if (tableIndex < 0) {
      return;
    }
    const insideCell = stack
      .slice(tableIndex + 1)
      .some((entry) => entry.name === "td" || entry.name === "th");
    if (!insideCell) {
      stack.length = tableIndex;
    }
  }

  function closeThrough(name: string) {
    const matchingIndex = stack.findLastIndex((entry) => entry.name === name);
    if (matchingIndex < 0) {
      return false;
    }
    stack.length = matchingIndex;
    return true;
  }

  function closeToParent(parentName: string) {
    const parentIndex = stack.findLastIndex(
      (entry) => entry.name === parentName,
    );
    if (parentIndex < 0) {
      return false;
    }
    stack.length = parentIndex + 1;
    return true;
  }

  for (const match of input.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? cursor;
    appendText(input.slice(cursor, matchIndex));
    cursor = matchIndex + match[0].length;

    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    const value = match[3]?.trim();

    if (stack.at(-1)?.name === "code" && !(closing && name === "code")) {
      appendText(match[0]);
      continue;
    }

    if (!SUPPORTED_TAGS.has(name)) {
      appendText(match[0]);
      continue;
    }

    if (name === "*" && !closing) {
      if (!closeToParent("list")) {
        appendText(match[0]);
        continue;
      }
      const item: ForumBbcodeTagNode = {
        type: "tag",
        name: "*",
        children: [],
      };
      children().push(item);
      stack.push(item);
      continue;
    }

    if (closing) {
      // Close unclosed descendants along with their parent. Agent-authored BBCode
      // commonly omits [/step], [/*], [/td], or [/tr], and strict stack matching
      // would otherwise expose the closing tag or swallow the rest of the post.
      closeThrough(name);
      continue;
    }

    if (name === "table" && stack.at(-1)?.name === "table") {
      // Models occasionally repeat the table opener. Treat it as one table;
      // an extra closing tag is harmless because unmatched supported closers
      // are ignored above.
      continue;
    }

    if (FLOW_BLOCK_TAGS.has(name)) {
      while (INLINE_TAGS.has(stack.at(-1)?.name ?? "")) {
        stack.pop();
      }
      if (stack.at(-1)?.name === "h2" || stack.at(-1)?.name === "h3") {
        stack.pop();
      }
    }

    if (name === "tr") {
      if (stack.some((entry) => entry.name === "tbody")) {
        closeToParent("tbody");
      } else if (stack.some((entry) => entry.name === "thead")) {
        closeToParent("thead");
      } else if (stack.some((entry) => entry.name === "tfoot")) {
        closeToParent("tfoot");
      } else {
        closeToParent("table");
      }
    } else if (name === "td" || name === "th") {
      closeToParent("tr");
    } else if (name === "thead" || name === "tbody" || name === "tfoot") {
      closeToParent("table");
    } else if (name === "step") {
      closeToParent("steps");
    }

    const node: ForumBbcodeTagNode = {
      type: "tag",
      name,
      ...(value ? { value } : {}),
      children: [],
    };
    children().push(node);
    if (!SELF_CLOSING_TAGS.has(name) && stack.length < 32) {
      stack.push(node);
    }
  }

  appendText(input.slice(cursor));
  return root;
}

export function forumStructuredBlockRows(node: ForumBbcodeTagNode): string[][] {
  if (node.name === "steps") {
    const explicitSteps = node.children.filter(
      (child): child is ForumBbcodeTagNode =>
        child.type === "tag" && child.name === "step",
    );
    if (explicitSteps.length > 0) {
      return explicitSteps
        .slice(0, 10)
        .map((step, index) => [
          String(index + 1),
          forumBbcodePlainText(step.children).trim(),
        ]);
    }

    const listItems = node.children
      .filter(
        (child): child is ForumBbcodeTagNode =>
          child.type === "tag" && child.name === "list",
      )
      .flatMap((list) =>
        list.children.filter(
          (child): child is ForumBbcodeTagNode =>
            child.type === "tag" && child.name === "*",
        ),
      );
    if (listItems.length > 0) {
      return listItems
        .slice(0, 10)
        .map((item, index) => [
          String(index + 1),
          forumBbcodePlainText(item.children).trim(),
        ]);
    }
  }

  const rows = forumBbcodePlainText(node.children)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line, index) => {
      const cells = splitStructuredRow(
        line,
        STRUCTURED_COLUMN_COUNTS[node.name],
      );
      if (node.name === "steps" && cells.length === 1) {
        return [String(index + 1), cells[0] ?? ""];
      }
      return cells;
    });

  const expectedHeaders = STRUCTURED_HEADER_ROWS[node.name] ?? [];
  const firstRow = rows[0]?.map((cell) => normalizedHeaderCell(cell));
  const hasHeader = expectedHeaders.some((header) =>
    header.every((cell, index) => firstRow?.[index] === cell),
  );
  return hasHeader ? rows.slice(1) : rows;
}

export function forumStructuredBlockTitle(node: ForumBbcodeTagNode) {
  if (node.value) {
    return node.value.slice(0, 120);
  }
  if (node.name === "steps") {
    const intro = node.children
      .filter((child) => child.type === "text")
      .map((child) => child.value.trim())
      .filter(Boolean)
      .join(" ");
    if (intro && !intro.includes("|")) {
      return intro.slice(0, 120);
    }
  }
  return structuredBlockLabel(node.name);
}

function structuredBlockLabel(name: string) {
  return name === "riskmap"
    ? "Risk map"
    : name === "decision"
      ? "Decision matrix"
      : name === "timeline"
        ? "Timeline"
        : name === "steps"
          ? "Action sequence"
          : "Related resources";
}

function forumBbcodePlainText(nodes: ForumBbcodeNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" ? node.value : forumBbcodePlainText(node.children),
    )
    .join("");
}

export function decodeForumEntities(value: string) {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,
    (entity, rawName: string) => {
      if (rawName.startsWith("#")) {
        const hexadecimal = rawName[1]?.toLowerCase() === "x";
        const parsed = Number.parseInt(
          rawName.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        return Number.isFinite(parsed) && parsed > 0 && parsed <= 0x10ffff
          ? String.fromCodePoint(parsed)
          : entity;
      }
      return (
        FORUM_HTML_ENTITIES[rawName] ??
        FORUM_HTML_ENTITIES[rawName.toLowerCase()] ??
        entity
      );
    },
  );
}

export function normalizeForumAgentMarkup(input: string) {
  const lines = forumBreakTagsToNewlines(input)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const normalized: string[] = [];
  let protectedBlock: string | null = null;

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (protectedBlock) {
      normalized.push(line);
      if (new RegExp(`(?:\\[/|</)${protectedBlock}(?:\\]|>)`, "i").test(line)) {
        protectedBlock = null;
      }
      index += 1;
      continue;
    }

    const protectedMatch = trimmed.match(
      /^(?:\[|<)(chart|code|decision|riskmap|sourcecards|steps|table|timeline)(?:=[^\]>]*)?(?:\]|>)/i,
    );
    if (protectedMatch) {
      const blockName = protectedMatch[1]?.toLowerCase() ?? "";
      if (blockName === "table") {
        const recoveredTable = readWrappedLegacyPipeTable(
          lines,
          index,
          protectedMatch[0],
        );
        if (recoveredTable) {
          normalized.push(recoveredTable.markup);
          index = recoveredTable.nextIndex;
          continue;
        }
      }
      normalized.push(line);
      if (
        PIPE_BLOCK_TAGS.has(blockName) &&
        !new RegExp(`(?:\\[/|</)${blockName}(?:\\]|>)`, "i").test(
          line.slice(protectedMatch[0].length),
        )
      ) {
        protectedBlock = blockName;
      }
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([a-z0-9#+.-]{0,24})\s*$/i);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !/^```\s*$/.test(lines[index]?.trim() ?? "")
      ) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const language = fence[1] ? `=${fence[1].toLowerCase()}` : "";
      const code = codeLines.join("\n").replace(/\[\/code\]/gi, "&#91;/code]");
      normalized.push(`[code${language}]${code}[/code]`);
      continue;
    }

    const pipeTable = readLegacyPipeTable(lines, index);
    if (pipeTable) {
      normalized.push(pipeTable.markup);
      index = pipeTable.nextIndex;
      continue;
    }

    const heading = line.match(/^\s*(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const tag = heading[1]?.length === 2 ? "h2" : "h3";
      normalized.push(
        `[${tag}]${normalizeMarkdownLinks(heading[2] ?? "")}[/${tag}]`,
      );
      index += 1;
      continue;
    }

    const quoteLines = readMarkdownQuote(lines, index);
    if (quoteLines) {
      normalized.push(`[quote]${quoteLines.body}[/quote]`);
      index = quoteLines.nextIndex;
      continue;
    }

    const markdownList = readMarkdownList(lines, index);
    if (markdownList) {
      normalized.push(markdownList.markup);
      index = markdownList.nextIndex;
      continue;
    }

    normalized.push(normalizeMarkdownLinks(line));
    index += 1;
  }

  return normalized.join("\n");
}

function forumBreakTagsToNewlines(input: string) {
  let insideCode = false;
  return input.replace(
    /(?:\[|<)(\/?)(code|br)(?:=[^\]>]*)?\s*\/?(?:\]|>)/gi,
    (match, closing: string, rawName: string) => {
      const name = rawName.toLowerCase();
      if (name === "code") {
        insideCode = closing !== "/";
        return match;
      }
      return insideCode ? match : "\n";
    },
  );
}

function readLegacyPipeTable(lines: string[], startIndex: number) {
  const rows: string[][] = [];
  let index = startIndex;
  while (index < lines.length) {
    const cells = parsePipeRow(lines[index] ?? "");
    if (!cells) {
      break;
    }
    rows.push(cells);
    index += 1;
  }

  if (rows.length < 2) {
    return null;
  }

  const dataRows = validLegacyPipeRows(rows);
  if (!dataRows) {
    return null;
  }

  return {
    markup: `[table]\n${legacyPipeRowsMarkup(dataRows)}\n[/table]`,
    nextIndex: index,
  };
}

function readWrappedLegacyPipeTable(
  lines: string[],
  startIndex: number,
  openingTag: string,
) {
  if ((lines[startIndex] ?? "").trim() !== openingTag) {
    return null;
  }

  const rows: string[][] = [];
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^(?:\[\/table\]|<\/table>)$/i.test(line.trim())) {
      break;
    }
    if (!line.trim()) {
      continue;
    }
    const cells = parsePipeRow(line, true);
    if (!cells) {
      return null;
    }
    rows.push(cells);
  }

  if (index >= lines.length) {
    return null;
  }
  const dataRows = validLegacyPipeRows(rows);
  if (!dataRows) {
    return null;
  }
  return {
    markup: `${openingTag}\n${legacyPipeRowsMarkup(dataRows)}\n[/table]`,
    nextIndex: index + 1,
  };
}

function validLegacyPipeRows(rows: string[][]) {
  const separatorIndex = isMarkdownTableSeparator(rows[1]) ? 1 : -1;
  const dataRows = rows.filter((_row, rowIndex) => rowIndex !== separatorIndex);
  const columnCount = dataRows[0]?.length ?? 0;
  if (
    columnCount < 2 ||
    dataRows.length < 2 ||
    dataRows.some((row) => row.length !== columnCount)
  ) {
    return null;
  }
  return dataRows;
}

function legacyPipeRowsMarkup(rows: string[][]) {
  return rows
    .map((row, rowIndex) => {
      const cellTag = rowIndex === 0 ? "th" : "td";
      return `[tr]${row
        .map(
          (cell) => `[${cellTag}]${normalizeMarkdownLinks(cell)}[/${cellTag}]`,
        )
        .join("")}[/tr]`;
    })
    .join("\n");
}

function parsePipeRow(line: string, allowLeadingMarkup = false) {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || (!allowLeadingMarkup && /^\[/.test(trimmed))) {
    return null;
  }
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = withoutOuterPipes.split("|").map((cell) => cell.trim());
  return cells.length >= 2 && cells.length <= 8 && cells.every(Boolean)
    ? cells
    : null;
}

function isMarkdownTableSeparator(row: string[] | undefined) {
  return Boolean(
    row?.length && row.every((cell) => /^:?-{3,}:?$/.test(cell.trim())),
  );
}

function readMarkdownQuote(lines: string[], startIndex: number) {
  if (!/^\s*>\s?/.test(lines[startIndex] ?? "")) {
    return null;
  }
  const quoteLines: string[] = [];
  let index = startIndex;
  while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
    quoteLines.push(
      normalizeMarkdownLinks((lines[index] ?? "").replace(/^\s*>\s?/, "")),
    );
    index += 1;
  }
  return { body: quoteLines.join("\n"), nextIndex: index };
}

function readMarkdownList(lines: string[], startIndex: number) {
  const first = markdownListItem(lines[startIndex] ?? "");
  if (!first) {
    return null;
  }
  const items: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const item = markdownListItem(lines[index] ?? "");
    if (!item || item.ordered !== first.ordered) {
      break;
    }
    items.push(normalizeMarkdownLinks(item.body));
    index += 1;
  }
  if (items.length < 2) {
    return null;
  }
  return {
    markup: `[list${first.ordered ? "=1" : ""}]${items
      .map((item) => `[*]${item}`)
      .join("\n")}[/list]`,
    nextIndex: index,
  };
}

function markdownListItem(line: string) {
  const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
  if (unordered) {
    return { body: unordered[1] ?? "", ordered: false };
  }
  const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  return ordered ? { body: ordered[1] ?? "", ordered: true } : null;
}

function normalizeMarkdownLinks(value: string) {
  return value.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi,
    "[url=$2]$1[/url]",
  );
}

function splitStructuredRow(line: string, expectedColumns?: number) {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (character === "\\" && line[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  cells.push(current.trim());

  if (expectedColumns && cells.length > expectedColumns) {
    const overflow = cells
      .slice(expectedColumns)
      .filter((cell) => !isOpaqueProvenanceToken(cell));
    return [
      ...cells.slice(0, expectedColumns - 1),
      [cells[expectedColumns - 1] ?? "", ...overflow].join(" | "),
    ];
  }
  return cells;
}

function isOpaqueProvenanceToken(value: string) {
  return /^[a-f\d]{12,}(?:-\d+)?$/i.test(value.trim());
}

function normalizedHeaderCell(value: string) {
  return decodeForumEntities(value)
    .replace(/\[[^\]]+\]/g, "")
    .trim()
    .toLowerCase();
}
