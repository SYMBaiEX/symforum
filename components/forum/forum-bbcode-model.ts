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

    if (name === "tr") {
      closeToParent("table");
    } else if (name === "td" || name === "th") {
      closeToParent("tr");
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
    if (!SELF_CLOSING_TAGS.has(name)) {
      stack.push(node);
    }
  }

  appendText(input.slice(cursor));
  return root;
}

export function forumStructuredBlockRows(
  node: ForumBbcodeTagNode,
): string[][] {
  if (node.name === "steps") {
    const explicitSteps = node.children.filter(
      (child): child is ForumBbcodeTagNode =>
        child.type === "tag" && child.name === "step",
    );
    if (explicitSteps.length > 0) {
      return explicitSteps.slice(0, 10).map((step, index) => [
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
      return listItems.slice(0, 10).map((item, index) => [
        String(index + 1),
        forumBbcodePlainText(item.children).trim(),
      ]);
    }
  }

  return forumBbcodePlainText(node.children)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line, index) => {
      const cells = line.split("|").map((cell) => cell.trim());
      if (node.name === "steps" && cells.length === 1) {
        return [String(index + 1), cells[0] ?? ""];
      }
      return cells;
    });
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
    if (intro) {
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
      node.type === "text"
        ? node.value
        : forumBbcodePlainText(node.children),
    )
    .join("");
}
