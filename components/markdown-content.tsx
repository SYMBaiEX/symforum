/* eslint-disable @next/next/no-img-element */
import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import type { Root } from "mdast";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Plugin } from "unified";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const richInlineTags = new Set(["u", "mark", "sup", "sub", "kbd"]);
const calloutLabels: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
};

const remarkEditorRichText: Plugin<[], Root> = () => (tree) => {
  transformMarkdownTree(tree as MarkdownNode);
};

export function MarkdownContent({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkEditorRichText]}
        rehypePlugins={[rehypeSlug, rehypeKatex]}
        components={{
          a({ href, children }) {
            const cleanHref = normalizeMarkdownHref(href);
            if (cleanHref.startsWith("/")) {
              return (
                <Link href={cleanHref} prefetch>
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={cleanHref}
                rel={
                  isExternalHref(cleanHref) ? "noopener noreferrer" : undefined
                }
                target={isExternalHref(cleanHref) ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
          blockquote({ children, className, ...props }) {
            const calloutType = getCalloutType(props);
            if (!calloutType) {
              return (
                <blockquote className={className} {...props}>
                  {children}
                </blockquote>
              );
            }

            return (
              <blockquote className={cn("callout", className)} {...props}>
                <p className="callout-title">{calloutLabels[calloutType]}</p>
                {children}
              </blockquote>
            );
          },
          img({ src, alt, ...props }) {
            const cleanSrc = normalizeMarkdownImageSrc(src);
            if (!cleanSrc) {
              return null;
            }
            return (
              <img
                {...props}
                alt={alt ?? ""}
                decoding="async"
                loading="lazy"
                src={cleanSrc}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function transformMarkdownTree(node: MarkdownNode) {
  if (node.type === "blockquote") {
    markCallout(node);
  }

  if (!node.children) {
    return;
  }

  for (const child of node.children) {
    transformMarkdownTree(child);
  }

  if (isInlineContainer(node)) {
    node.children = transformInlineSequence(node.children);
  }
}

function isInlineContainer(node: MarkdownNode) {
  return [
    "paragraph",
    "heading",
    "emphasis",
    "strong",
    "delete",
    "link",
    "linkReference",
    "tableCell",
  ].includes(node.type);
}

function transformInlineSequence(children: MarkdownNode[]) {
  const transformed: MarkdownNode[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const openTag = parseEditorOpeningTag(child);
    if (openTag) {
      const closeIndex = findMatchingClose(children, index + 1, openTag.name);
      if (closeIndex !== -1) {
        transformed.push({
          type: "editorRichText",
          data: {
            hName: openTag.name,
            hProperties: openTag.properties,
          },
          children: transformInlineSequence(
            children.slice(index + 1, closeIndex),
          ),
        });
        index = closeIndex;
        continue;
      }
    }

    if (child.type === "html") {
      continue;
    }

    transformed.push(child);
  }

  return transformed;
}

function findMatchingClose(
  children: MarkdownNode[],
  startIndex: number,
  tagName: string,
) {
  let depth = 0;

  for (let index = startIndex; index < children.length; index += 1) {
    const child = children[index];
    const openTag = parseEditorOpeningTag(child);
    if (openTag?.name === tagName) {
      depth += 1;
      continue;
    }

    if (isEditorClosingTag(child, tagName)) {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return -1;
}

function parseEditorOpeningTag(node: MarkdownNode) {
  if (node.type !== "html" || !node.value) {
    return null;
  }

  const tag = node.value.trim();
  const simpleMatch = tag.match(/^<(u|mark|sup|sub|kbd)>$/i);
  if (simpleMatch) {
    const name = simpleMatch[1].toLowerCase();
    return richInlineTags.has(name) ? { name, properties: {} } : null;
  }

  const spanMatch = tag.match(/^<span\s+style=(["'])(.*?)\1>$/i);
  if (!spanMatch) {
    return null;
  }

  const style = sanitizeEditorStyle(spanMatch[2]);
  return style ? { name: "span", properties: { style } } : null;
}

function isEditorClosingTag(node: MarkdownNode, tagName: string) {
  return (
    node.type === "html" &&
    node.value?.trim().toLowerCase() === `</${tagName}>`
  );
}

function sanitizeEditorStyle(value: string) {
  const lowerValue = value.toLowerCase();
  if (
    ["<", ">", "url(", "expression", "javascript:", "behavior:"].some((token) =>
      lowerValue.includes(token),
    )
  ) {
    return null;
  }

  const declarations: string[] = [];
  for (const rawDeclaration of value.split(";")) {
    const [rawProperty, ...rawParts] = rawDeclaration.split(":");
    if (!rawProperty || rawParts.length === 0) {
      continue;
    }

    const property = rawProperty.trim().toLowerCase();
    const propertyValue = rawParts.join(":").trim();
    const normalizedValue = propertyValue.toLowerCase();

    if (
      property === "font-size" &&
      /^(?:0?\.\d+|[1-3](?:\.\d+)?)(?:em|rem)$/.test(normalizedValue)
    ) {
      declarations.push(`font-size: ${normalizedValue}`);
      continue;
    }

    if (
      property === "font-family" &&
      /^[a-z0-9\s,.-]+$/i.test(propertyValue)
    ) {
      declarations.push(`font-family: ${propertyValue}`);
      continue;
    }

    if (property === "color" && /^#[0-9a-f]{6}$/i.test(propertyValue)) {
      declarations.push(`color: ${propertyValue}`);
      continue;
    }

    if (property === "display" && normalizedValue === "block") {
      declarations.push("display: block");
      continue;
    }

    if (
      property === "text-align" &&
      ["left", "center", "right"].includes(normalizedValue)
    ) {
      declarations.push(`text-align: ${normalizedValue}`);
    }
  }

  return declarations.length > 0 ? `${declarations.join("; ")};` : null;
}

function markCallout(node: MarkdownNode) {
  const firstChild = node.children?.[0];
  const firstParagraph = firstChild?.type === "paragraph" ? firstChild : null;
  const firstText = firstParagraph?.children?.[0];
  if (!firstText || firstText.type !== "text" || !firstText.value) {
    return;
  }

  const match = firstText.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*/i);
  if (!match) {
    return;
  }

  const type = match[1].toLowerCase();
  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      className: ["callout", `callout-${type}`],
      "data-callout": type,
    },
  };

  firstText.value = firstText.value.slice(match[0].length);
  if (firstText.value.length === 0) {
    firstParagraph.children = firstParagraph.children?.slice(1);
  }
  if (firstParagraph.children?.length === 0) {
    node.children = node.children?.slice(1);
  }
}

function getCalloutType(props: Record<string, unknown>) {
  const callout = props["data-callout"];
  return typeof callout === "string" && callout in calloutLabels
    ? callout
    : null;
}

function normalizeMarkdownImageSrc(src: string | Blob | undefined) {
  if (typeof src !== "string" || !src) {
    return undefined;
  }
  return safeImageUrl(src);
}

function normalizeMarkdownHref(href: string | undefined) {
  if (!href) {
    return "#";
  }
  if (href.startsWith("/") || href.startsWith("#")) {
    return href;
  }
  return safeExternalUrl(href) ?? "#";
}

function isExternalHref(href: string) {
  return href.startsWith("http://") || href.startsWith("https://");
}
