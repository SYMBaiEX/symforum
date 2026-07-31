type ForumBbcodeTextNode = {
  type: "text";
  value: string;
};

type ForumBbcodeTagNode = {
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
  "steps",
  "table",
  "timeline",
  "td",
  "th",
  "tr",
  "u",
  "url",
  "warning",
]);

const SELF_CLOSING_TAGS = new Set(["br", "hr"]);

export function parseForumBbcode(input: string): ForumBbcodeNode[] {
  const root: ForumBbcodeNode[] = [];
  const stack: ForumBbcodeTagNode[] = [];
  const tokenPattern = /\[(\/?)([a-z0-9*]+)(?:=([^\]]*))?\]/gi;
  let cursor = 0;

  function children() {
    return stack.at(-1)?.children ?? root;
  }

  function appendText(value: string) {
    if (!value) {
      return;
    }
    const target = children();
    const previous = target.at(-1);
    if (previous?.type === "text") {
      previous.value += value;
      return;
    }
    target.push({ type: "text", value });
  }

  for (const match of input.matchAll(tokenPattern)) {
    const matchIndex = match.index ?? cursor;
    appendText(input.slice(cursor, matchIndex));
    cursor = matchIndex + match[0].length;

    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    const value = match[3]?.trim();
    if (!SUPPORTED_TAGS.has(name)) {
      appendText(match[0]);
      continue;
    }

    if (name === "*" && !closing) {
      const listIndex = stack.findLastIndex((entry) => entry.name === "list");
      if (listIndex < 0) {
        appendText(match[0]);
        continue;
      }
      if (stack.at(-1)?.name === "*") {
        stack.pop();
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
      if (name === "list" && stack.at(-1)?.name === "*") {
        stack.pop();
      }
      if (stack.at(-1)?.name === name) {
        stack.pop();
      } else {
        appendText(match[0]);
      }
      continue;
    }

    const node: ForumBbcodeTagNode = {
      type: "tag",
      name,
      ...(value ? { value } : {}),
      children: [],
    };
    children().push(node);
    if (!SELF_CLOSING_TAGS.has(name)) {
      stack.push(node);
    }
  }

  appendText(input.slice(cursor));
  return root;
}
