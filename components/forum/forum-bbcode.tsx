import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import { Fragment, type ReactNode } from "react";
import { parseForumBbcode, type ForumBbcodeNode } from "./forum-bbcode-model";

type ForumBbcodeTagNode = Extract<ForumBbcodeNode, { type: "tag" }>;

const FORUM_SMILIES = new Map([
  [":)", ":)"],
  [":D", ":D"],
  [";)", ";)"],
  [":P", ":P"],
  [":(", ":("],
  [":o", ":o"],
  [":cool:", "cool"],
  [":heart:", "<3"],
]);

const BLOCK_TAGS = new Set([
  "center",
  "code",
  "h2",
  "h3",
  "hr",
  "img",
  "list",
  "note",
  "quote",
  "spoiler",
  "table",
  "warning",
]);

export function ForumBbcodeBody({ body }: { body: string }) {
  return <>{renderFlowNodes(parseForumBbcode(body), "forum-body")}</>;
}

function renderFlowNodes(
  nodes: ForumBbcodeNode[],
  keyPrefix: string,
): ReactNode[] {
  const rendered: ReactNode[] = [];
  let inlineBuffer: ForumBbcodeNode[] = [];
  let blockIndex = 0;

  function flushInline() {
    const trimmed = trimBoundaryWhitespace(inlineBuffer);
    inlineBuffer = [];
    if (trimmed.length === 0 || forumBbcodeText(trimmed).trim().length === 0) {
      return;
    }
    const key = `${keyPrefix}-paragraph-${blockIndex}`;
    blockIndex += 1;
    if (
      trimmed.length === 1 &&
      trimmed[0]?.type === "tag" &&
      trimmed[0].name === "b"
    ) {
      rendered.push(
        <h3
          className="text-base font-semibold leading-6 text-foreground md:text-lg"
          key={key}
        >
          {renderInlineNodes(trimmed[0].children, `${key}-heading`)}
        </h3>,
      );
      return;
    }
    rendered.push(
      <p className="min-w-0 break-words whitespace-pre-wrap" key={key}>
        {renderInlineNodes(trimmed, `${key}-inline`)}
      </p>,
    );
  }

  for (const node of nodes) {
    if (node.type === "tag" && BLOCK_TAGS.has(node.name)) {
      flushInline();
      const key = `${keyPrefix}-block-${blockIndex}`;
      blockIndex += 1;
      rendered.push(renderBlockTag(node, key));
      continue;
    }

    if (node.type !== "text") {
      inlineBuffer.push(node);
      continue;
    }

    const segments = node.value.split(/(\n{2,})/);
    for (const segment of segments) {
      if (/^\n{2,}$/.test(segment)) {
        flushInline();
      } else if (segment) {
        inlineBuffer.push({ type: "text", value: segment });
      }
    }
  }

  flushInline();
  return rendered;
}

function renderBlockTag(node: ForumBbcodeTagNode, key: string): ReactNode {
  if (node.name === "h2" || node.name === "h3") {
    const Heading = node.name;
    return (
      <Heading
        className={
          node.name === "h2"
            ? "border-b border-row-border pb-2 text-xl font-semibold leading-tight md:text-2xl"
            : "text-base font-semibold leading-6 md:text-lg"
        }
        key={key}
      >
        {renderInlineNodes(node.children, `${key}-heading`)}
      </Heading>
    );
  }

  if (node.name === "quote") {
    return (
      <blockquote
        className="border-l-2 border-primary/60 bg-muted/35 px-4 py-3"
        key={key}
      >
        {node.value ? (
          <p className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">
            {node.value} wrote
          </p>
        ) : null}
        <div className="space-y-3 text-muted-foreground">
          {renderFlowNodes(node.children, `${key}-quote`)}
        </div>
      </blockquote>
    );
  }

  if (node.name === "code") {
    return (
      <pre
        className="max-w-full overflow-x-auto border border-row-border bg-muted/35 p-3 font-mono text-xs leading-6"
        key={key}
      >
        <code>{forumBbcodeText(node.children).replace(/^\n|\n$/g, "")}</code>
      </pre>
    );
  }

  if (node.name === "list") {
    const items = node.children.filter(
      (child): child is ForumBbcodeTagNode =>
        child.type === "tag" && child.name === "*",
    );
    const ordered = /^(1|a|i)$/i.test(node.value ?? "");
    const List = ordered ? "ol" : "ul";
    const listStyle = ordered
      ? node.value?.toLowerCase() === "a"
        ? "list-[lower-alpha]"
        : node.value?.toLowerCase() === "i"
          ? "list-[lower-roman]"
          : "list-decimal"
      : "list-disc";
    return (
      <List
        className={`${listStyle} space-y-2 pl-6 marker:text-primary`}
        key={key}
      >
        {items.map((item, index) => (
          <li className="pl-1" key={`${key}-item-${index}`}>
            <div className="space-y-2">
              {renderFlowNodes(item.children, `${key}-item-${index}`)}
            </div>
          </li>
        ))}
      </List>
    );
  }

  if (node.name === "spoiler") {
    return (
      <details className="group border border-row-border bg-muted/15" key={key}>
        <summary className="focus-ring flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground marker:content-none">
          <span>{node.value || "Spoiler"}</span>
          <span aria-hidden="true" className="text-primary">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
        </summary>
        <div className="space-y-3 border-t border-row-border px-4 py-3">
          {renderFlowNodes(node.children, `${key}-spoiler`)}
        </div>
      </details>
    );
  }

  if (node.name === "note" || node.name === "warning") {
    const warning = node.name === "warning";
    return (
      <aside
        className={
          warning
            ? "border-l-2 border-accent-canary bg-accent-canary/10 px-4 py-3"
            : "border-l-2 border-accent bg-accent/10 px-4 py-3"
        }
        key={key}
      >
        <p className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">
          {warning ? "Warning" : "Note"}
        </p>
        <div className="space-y-3">
          {renderFlowNodes(node.children, `${key}-${node.name}`)}
        </div>
      </aside>
    );
  }

  if (node.name === "table") {
    const rows = node.children.filter(
      (child): child is ForumBbcodeTagNode =>
        child.type === "tag" && child.name === "tr",
    );
    return (
      <div
        className="max-w-full overflow-x-auto border border-row-border"
        key={key}
      >
        <table className="w-full min-w-[32rem] border-collapse text-left">
          <caption className="sr-only">Forum comparison table</caption>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                className="border-b border-row-border last:border-b-0"
                key={`${key}-row-${rowIndex}`}
              >
                {row.children
                  .filter(
                    (child): child is ForumBbcodeTagNode =>
                      child.type === "tag" &&
                      (child.name === "th" || child.name === "td"),
                  )
                  .map((cell, cellIndex) => {
                    const cellKey = `${key}-cell-${rowIndex}-${cellIndex}`;
                    const content = renderInlineNodes(cell.children, cellKey);
                    return cell.name === "th" ? (
                      <th
                        className="bg-muted/35 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground"
                        key={cellKey}
                      >
                        {content}
                      </th>
                    ) : (
                      <td className="px-3 py-3 align-top text-sm" key={cellKey}>
                        {content}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (node.name === "center") {
    return (
      <div className="space-y-3 text-center" key={key}>
        {renderFlowNodes(node.children, `${key}-center`)}
      </div>
    );
  }

  if (node.name === "img") {
    return renderForumImage(node, key);
  }

  if (node.name === "hr") {
    return <hr className="border-0 border-t border-row-border" key={key} />;
  }

  return (
    <p className="break-words whitespace-pre-wrap" key={key}>
      {renderInlineNodes([node], `${key}-fallback`)}
    </p>
  );
}

function renderInlineNodes(
  nodes: ForumBbcodeNode[],
  keyPrefix: string,
): ReactNode[] {
  return nodes.flatMap((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") {
      return renderTextWithBreaks(node.value, key);
    }

    if (node.name === "b") {
      return (
        <strong key={key}>
          {renderInlineNodes(node.children, `${key}-bold`)}
        </strong>
      );
    }
    if (node.name === "i") {
      return (
        <em key={key}>{renderInlineNodes(node.children, `${key}-italic`)}</em>
      );
    }
    if (node.name === "u") {
      return (
        <span className="underline underline-offset-2" key={key}>
          {renderInlineNodes(node.children, `${key}-underline`)}
        </span>
      );
    }
    if (node.name === "s") {
      return (
        <s key={key}>{renderInlineNodes(node.children, `${key}-strike`)}</s>
      );
    }
    if (node.name === "kbd") {
      return (
        <kbd
          className="border border-row-border bg-muted/35 px-1.5 py-0.5 font-mono text-[0.85em]"
          key={key}
        >
          {forumBbcodeText(node.children)}
        </kbd>
      );
    }
    if (node.name === "mark") {
      return (
        <mark className="bg-primary/15 px-1 text-foreground" key={key}>
          {renderInlineNodes(node.children, `${key}-mark`)}
        </mark>
      );
    }
    if (node.name === "url") {
      const href = safeExternalUrl(
        node.value || forumBbcodeText(node.children),
      );
      const label = forumBbcodeText(node.children).trim() || href;
      if (!href || !label) {
        return forumBbcodeText(node.children);
      }
      return (
        <a
          className="focus-ring break-words underline decoration-primary/60 underline-offset-2 hover:text-primary"
          href={href}
          key={key}
          rel="noreferrer"
          target="_blank"
        >
          {renderInlineNodes(node.children, `${key}-link`)}
        </a>
      );
    }
    if (node.name === "img") {
      return renderForumImage(node, key);
    }
    if (node.name === "br") {
      return <br key={key} />;
    }

    return <Fragment key={key}>{forumBbcodeText(node.children)}</Fragment>;
  });
}

function renderForumImage(node: ForumBbcodeTagNode, key: string) {
  const src = safeImageUrl(forumBbcodeText(node.children).trim());
  if (!src) {
    return forumBbcodeText(node.children);
  }
  const alt = node.value?.slice(0, 180) ?? "";
  return (
    <figure className="my-3 max-w-full" key={key}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Forum BBCode images can be external user content. */}
      <img
        alt={alt}
        className="max-h-[32rem] max-w-full border border-row-border object-contain"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={src}
      />
      {alt ? (
        <figcaption className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
}

function renderTextWithBreaks(value: string, keyPrefix: string): ReactNode[] {
  return value.split("\n").flatMap((line, lineIndex, lines) => {
    const rendered = renderForumSmilies(line, `${keyPrefix}-${lineIndex}`);
    return lineIndex < lines.length - 1
      ? [...rendered, <br key={`${keyPrefix}-break-${lineIndex}`} />]
      : rendered;
  });
}

function renderForumSmilies(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(:\)|:D|;\)|:P|:\(|:o|:cool:|:heart:)/g;
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const label = FORUM_SMILIES.get(part);
      if (!label) {
        return <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>;
      }
      return (
        <span
          aria-label="smilie"
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center border border-row-border bg-muted/35 px-1 font-mono text-[10px] uppercase leading-none text-muted-foreground"
          key={`${keyPrefix}-smilie-${index}`}
        >
          {label}
        </span>
      );
    });
}

function trimBoundaryWhitespace(nodes: ForumBbcodeNode[]) {
  const trimmed = nodes.map((node) =>
    node.type === "text" ? { ...node } : node,
  );
  while (trimmed[0]?.type === "text" && trimmed[0].value.trim().length === 0) {
    trimmed.shift();
  }
  while (true) {
    const last = trimmed.at(-1);
    if (last?.type !== "text" || last.value.trim().length > 0) {
      break;
    }
    trimmed.pop();
  }
  if (trimmed[0]?.type === "text") {
    trimmed[0].value = trimmed[0].value.replace(/^\s+/, "");
  }
  const last = trimmed.at(-1);
  if (last?.type === "text") {
    last.value = last.value.replace(/\s+$/, "");
  }
  return trimmed;
}

function forumBbcodeText(nodes: ForumBbcodeNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" ? node.value : forumBbcodeText(node.children),
    )
    .join("");
}
