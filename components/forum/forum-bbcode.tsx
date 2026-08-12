import { safeExternalUrl, safeImageUrl } from "@/lib/safe-url";
import { splitForumMentions } from "@/lib/forum-mentions";
import { Fragment, type ReactNode } from "react";
import { ForumLink } from "./forum-link";
import {
  decodeForumEntities,
  forumStructuredBlockRows,
  forumStructuredBlockTitle,
  parseForumBbcode,
  type ForumBbcodeNode,
  type ForumBbcodeTagNode,
} from "./forum-bbcode-model";

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
  "spoiler",
  "sourcecards",
  "steps",
  "table",
  "timeline",
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
      <p
        className="min-w-0 max-w-[76ch] whitespace-pre-wrap text-pretty [overflow-wrap:anywhere]"
        key={key}
      >
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
            ? "max-w-[68ch] border-b border-row-border pb-2 text-xl font-semibold leading-tight text-pretty md:text-2xl"
            : "max-w-[68ch] text-base font-semibold leading-6 text-pretty md:text-lg"
        }
        key={key}
      >
        {renderInlineNodes(node.children, `${key}-heading`)}
      </Heading>
    );
  }

  if (node.name === "quote") {
    return (
      <figure className="max-w-[76ch]" key={key}>
        <blockquote className="border-l-2 border-primary/60 bg-muted/35 px-4 py-3 text-muted-foreground">
          <div className="space-y-3">
            {renderFlowNodes(node.children, `${key}-quote`)}
          </div>
        </blockquote>
        {node.value ? (
          <figcaption className="mt-1.5 pl-4 font-mono text-[10px] uppercase text-muted-foreground">
            — {decodeForumEntities(node.value).slice(0, 120)}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (node.name === "code") {
    return (
      <figure
        className="max-w-full border border-row-border bg-muted/20"
        key={key}
      >
        <figcaption className="border-b border-row-border px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground">
          {node.value
            ? `Code · ${decodeForumEntities(node.value).slice(0, 24)}`
            : "Code"}
        </figcaption>
        <pre
          aria-label={node.value ? `${node.value} code sample` : "Code sample"}
          className="max-w-full overflow-x-auto p-3 font-mono text-xs leading-6 [tab-size:2]"
          tabIndex={0}
        >
          <code>
            {decodeForumEntities(
              forumBbcodeText(node.children).replace(/^\n|\n$/g, ""),
            )}
          </code>
        </pre>
      </figure>
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
        className={`${listStyle} max-w-[76ch] space-y-2 pl-6 marker:text-primary`}
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
      <details
        className="group max-w-[76ch] border border-row-border bg-muted/15"
        key={key}
      >
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
            ? "max-w-[76ch] border-l-2 border-accent-canary bg-accent-canary/10 px-4 py-3"
            : "max-w-[76ch] border-l-2 border-accent bg-accent/10 px-4 py-3"
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
    return renderForumTable(node, key);
  }

  if (node.name === "chart") {
    return renderForumChart(node, key);
  }

  if (
    node.name === "timeline" ||
    node.name === "decision" ||
    node.name === "riskmap" ||
    node.name === "steps" ||
    node.name === "sourcecards"
  ) {
    return renderForumStructuredBlock(node, key);
  }

  if (node.name === "center") {
    return (
      <div className="max-w-[76ch] space-y-3 text-center" key={key}>
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
    <p
      className="max-w-[76ch] whitespace-pre-wrap [overflow-wrap:anywhere]"
      key={key}
    >
      {renderInlineNodes([node], `${key}-fallback`)}
    </p>
  );
}

function renderForumTable(node: ForumBbcodeTagNode, key: string) {
  const rows = tableRowNodes(node.children)
    .map((row) =>
      row.children.filter(
        (child): child is ForumBbcodeTagNode =>
          child.type === "tag" && (child.name === "th" || child.name === "td"),
      ),
    )
    .filter((row) => row.length > 0);
  if (rows.length === 0) {
    const fallback = decodeForumEntities(forumBbcodeText(node.children).trim());
    return fallback ? (
      <p
        className="max-w-[76ch] whitespace-pre-wrap [overflow-wrap:anywhere]"
        key={key}
      >
        {fallback}
      </p>
    ) : null;
  }

  const firstRow = rows[0] ?? [];
  const hasHeaderRow = firstRow.some((cell) => cell.name === "th");
  const headers = hasHeaderRow
    ? firstRow.map(
        (cell, index) =>
          decodeForumEntities(forumBbcodeText(cell.children).trim()) ||
          `Column ${index + 1}`,
      )
    : [];
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const caption = decodeForumEntities(
    node.value?.slice(0, 120) || "Comparison table",
  );

  return (
    <figure className="max-w-full border border-row-border" key={key}>
      {node.value ? (
        <figcaption className="border-b border-row-border px-3 py-2.5 text-sm font-semibold">
          {caption}
        </figcaption>
      ) : null}
      <div className="divide-y divide-row-border sm:hidden">
        {dataRows.map((row, rowIndex) => (
          <dl
            className="grid gap-2 px-3 py-3"
            key={`${key}-mobile-row-${rowIndex}`}
          >
            {row.map((cell, cellIndex) => (
              <div
                className="grid grid-cols-[minmax(5.5rem,0.4fr)_minmax(0,1fr)] gap-3"
                key={`${key}-mobile-cell-${rowIndex}-${cellIndex}`}
              >
                <dt className="font-mono text-[10px] uppercase leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {headers[cellIndex] || `Column ${cellIndex + 1}`}
                </dt>
                <dd className="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]">
                  {renderInlineNodes(
                    cell.children,
                    `${key}-mobile-content-${rowIndex}-${cellIndex}`,
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      <div
        aria-label={`${caption}. Scroll horizontally if needed.`}
        className="hidden max-w-full overflow-x-auto sm:block"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          {hasHeaderRow ? (
            <thead>
              <tr className="border-b border-row-border">
                {firstRow.map((cell, cellIndex) => (
                  <th
                    className="bg-muted/35 px-3 py-2 font-mono text-[10px] uppercase text-muted-foreground [overflow-wrap:anywhere]"
                    key={`${key}-header-${cellIndex}`}
                    scope="col"
                  >
                    {renderInlineNodes(
                      cell.children,
                      `${key}-header-content-${cellIndex}`,
                    )}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {dataRows.map((row, rowIndex) => (
              <tr
                className="border-b border-row-border last:border-b-0"
                key={`${key}-row-${rowIndex}`}
              >
                {row.map((cell, cellIndex) => {
                  const cellKey = `${key}-cell-${rowIndex}-${cellIndex}`;
                  const content = renderInlineNodes(cell.children, cellKey);
                  return cell.name === "th" ? (
                    <th
                      className="bg-muted/20 px-3 py-3 align-top text-sm font-semibold [overflow-wrap:anywhere]"
                      key={cellKey}
                      scope="row"
                    >
                      {content}
                    </th>
                  ) : (
                    <td
                      className="px-3 py-3 align-top text-sm [overflow-wrap:anywhere]"
                      key={cellKey}
                    >
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function tableRowNodes(nodes: ForumBbcodeNode[]): ForumBbcodeTagNode[] {
  return nodes.flatMap((child) => {
    if (child.type !== "tag") return [];
    if (child.name === "tr") return [child];
    if (
      child.name === "thead" ||
      child.name === "tbody" ||
      child.name === "tfoot"
    ) {
      return tableRowNodes(child.children);
    }
    return [];
  });
}

function renderForumStructuredBlock(node: ForumBbcodeTagNode, key: string) {
  const rows = forumStructuredBlockRows(node);
  if (rows.length === 0) {
    return null;
  }
  const title = forumStructuredBlockTitle(node);

  if (node.name === "sourcecards") {
    const sources = rows.flatMap(([label, rawUrl, detail]) => {
      const link = forumLinkDetails(rawUrl ?? "");
      return label && link
        ? [
            {
              detail: decodeForumEntities(detail ?? ""),
              label: decodeForumEntities(label),
              ...link,
            },
          ]
        : [];
    });
    if (sources.length === 0) {
      return null;
    }
    return (
      <section className="border-y border-row-border" key={key}>
        <StructuredHeading label="Continue reading" title={title} />
        <div className="grid gap-px bg-row-border sm:grid-cols-2">
          {sources.map((source, index) => (
            <a
              className="focus-ring group min-w-0 bg-background px-3 py-3 transition-colors duration-100 hover:bg-muted/25 motion-reduce:transition-none"
              href={source.href}
              key={`${key}-source-${index}`}
              rel={source.external ? "noopener noreferrer" : undefined}
              target={source.external ? "_blank" : undefined}
            >
              <span className="block text-sm font-semibold leading-5 text-pretty [overflow-wrap:anywhere] group-hover:text-primary">
                {source.label.slice(0, 160)}
              </span>
              {source.detail ? (
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {source.detail.slice(0, 220)}
                </span>
              ) : null}
              <span className="mt-2 block font-mono text-[10px] uppercase text-muted-foreground">
                {source.hostname}
                {source.external ? " · External" : " · Forum"}
              </span>
              {source.external ? (
                <span className="sr-only"> (opens in a new tab)</span>
              ) : null}
            </a>
          ))}
        </div>
      </section>
    );
  }

  if (node.name === "timeline" || node.name === "steps") {
    return (
      <section className="border-y border-row-border" key={key}>
        <StructuredHeading
          label={node.name === "timeline" ? "Timeline" : "Action sequence"}
          title={title}
        />
        <ol className="divide-y divide-row-border">
          {rows.map(([marker, heading, detail], index) => (
            <li
              className={
                node.name === "timeline"
                  ? "grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-3"
                  : "grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-3 py-3"
              }
              key={`${key}-step-${index}`}
            >
              <span
                className={
                  node.name === "timeline"
                    ? "flex min-h-8 min-w-20 items-center justify-center border border-primary/50 px-2 py-1 text-center font-mono text-[10px] leading-4 text-primary"
                    : "flex h-8 w-8 items-center justify-center border border-primary/50 font-mono text-[10px] text-primary"
                }
              >
                {decodeForumEntities(marker || String(index + 1)).slice(0, 24)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-pretty [overflow-wrap:anywhere]">
                  {decodeForumEntities(heading || "Update")}
                </p>
                {detail ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {decodeForumEntities(detail).slice(0, 320)}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (node.name === "riskmap") {
    return (
      <section className="border-y border-row-border" key={key}>
        <StructuredHeading label="Risk map" title={title} />
        <div className="divide-y divide-row-border">
          {rows.map(([risk, likelihood, impact, mitigation], index) => {
            return (
              <div
                className="grid gap-2 px-3 py-3 md:grid-cols-[minmax(10rem,0.7fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] md:items-center"
                key={`${key}-risk-${index}`}
              >
                <p className="text-sm font-semibold text-pretty [overflow-wrap:anywhere]">
                  {decodeForumEntities(risk || "Risk")}
                </p>
                <RiskMetric label="Likelihood" value={likelihood} />
                <div>
                  <RiskMetric label="Impact" value={impact} />
                  {mitigation ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {decodeForumEntities(mitigation).slice(0, 240)}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="border-y border-row-border" key={key}>
      <StructuredHeading label="Decision matrix" title={title} />
      <div className="divide-y divide-row-border">
        {rows.map(([option, verdict, reason], index) => (
          <div
            className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(8rem,0.35fr)_minmax(0,1fr)] sm:items-start"
            key={`${key}-decision-${index}`}
          >
            <p className="text-sm font-semibold text-pretty [overflow-wrap:anywhere]">
              {decodeForumEntities(option || "Option")}
            </p>
            <span className="w-fit max-w-full border border-primary/45 px-2 py-1 font-mono text-[10px] uppercase leading-4 text-primary [overflow-wrap:anywhere]">
              {decodeForumEntities(verdict || "Consider").slice(0, 80)}
            </span>
            <p className="text-xs leading-5 text-muted-foreground">
              {decodeForumEntities(reason || "No rationale supplied.").slice(
                0,
                320,
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function StructuredHeading({ label, title }: { label: string; title: string }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-row-border px-3 py-2.5">
      <h3 className="text-sm font-semibold text-pretty">
        {decodeForumEntities(title)}
      </h3>
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
    </header>
  );
}

function SignalBar({ label, value }: { label?: string; value: number }) {
  return (
    <span
      aria-label={label ? `${label}: ${value} out of 100` : undefined}
      className="h-1.5 overflow-hidden bg-row-border"
      role={label ? "img" : undefined}
    >
      <span
        className="block h-full bg-primary"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

function boundedScore(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, Math.round(parsed)))
    : null;
}

function RiskMetric({ label, value }: { label: string; value?: string }) {
  const score = boundedScore(value);
  if (score === null) {
    return (
      <div className="flex min-h-6 items-center justify-between gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <span>{label}</span>
        <span className="border border-row-border px-2 py-0.5 text-foreground">
          {decodeForumEntities(value?.trim() || "Not scored").slice(0, 24)}
        </span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)_2rem] items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
      <span>{label}</span>
      <SignalBar label={label} value={score} />
      <span className="text-right tabular-nums">{score}</span>
    </div>
  );
}

function forumLinkDetails(value: string) {
  const safeUrl = safeExternalUrl(decodeForumEntities(value));
  if (!safeUrl) {
    return null;
  }
  const url = new URL(safeUrl);
  const forumPathOnPrimaryHost =
    (url.hostname === "symbaiex.com" || url.hostname === "www.symbaiex.com") &&
    (url.pathname === "/forum" || url.pathname.startsWith("/forum/"));
  const forumHost = url.hostname === "forum.symbaiex.com";
  if (forumHost || forumPathOnPrimaryHost) {
    const pathname = url.pathname.replace(/^\/forum(?=\/|$)/, "") || "/";
    return {
      external: false,
      hostname: "forum.symbaiex.com",
      href: `https://forum.symbaiex.com${pathname}${url.search}${url.hash}`,
    };
  }
  return {
    external: true,
    hostname: url.hostname.replace(/^www\./, ""),
    href: safeUrl,
  };
}

function renderForumChart(node: ForumBbcodeTagNode, key: string) {
  const rows = forumStructuredBlockRows(node)
    .slice(0, 8)
    .flatMap(([rawLabel, rawValue, rawDetail]) => {
      const label = decodeForumEntities(rawLabel?.trim() ?? "").slice(0, 80);
      const numericValue = Number(rawValue?.trim());
      if (!label || !Number.isFinite(numericValue)) {
        return [];
      }
      return [
        {
          detail: decodeForumEntities(rawDetail?.trim() ?? "").slice(0, 140),
          label,
          value: Math.max(0, Math.min(100, Math.round(numericValue))),
        },
      ];
    });
  if (rows.length === 0) {
    return (
      <p className="break-words whitespace-pre-wrap" key={key}>
        {decodeForumEntities(forumBbcodeText(node.children))}
      </p>
    );
  }
  const title = decodeForumEntities(
    node.value?.slice(0, 120) || "Signal chart",
  );

  return (
    <figure
      aria-label={title}
      className="border-y border-row-border bg-muted/10"
      key={key}
    >
      <figcaption className="flex items-center justify-between gap-4 border-b border-row-border px-3 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          Relative signal / 100
        </span>
      </figcaption>
      <div className="divide-y divide-row-border">
        {rows.map((row, index) => (
          <div
            className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(7rem,0.4fr)_minmax(12rem,1fr)] sm:items-center"
            key={`${key}-chart-row-${index}`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-pretty [overflow-wrap:anywhere]">
                {row.label}
              </p>
              {row.detail ? (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {row.detail}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2">
              <div
                aria-label={`${row.label}: ${row.value} out of 100`}
                className="h-2 overflow-hidden bg-row-border"
                role="img"
              >
                <div
                  className={
                    index % 3 === 1
                      ? "h-full bg-accent"
                      : index % 3 === 2
                        ? "h-full bg-accent-canary"
                        : "h-full bg-primary"
                  }
                  style={{ width: `${row.value}%` }}
                />
              </div>
              <span className="text-right font-mono text-xs tabular-nums text-foreground">
                {row.value}
              </span>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

function renderInlineNodes(
  nodes: ForumBbcodeNode[],
  keyPrefix: string,
  linkMentions = true,
): ReactNode[] {
  return nodes.flatMap((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") {
      return renderTextWithBreaks(node.value, key, linkMentions);
    }

    if (node.name === "b") {
      return (
        <strong key={key}>
          {renderInlineNodes(node.children, `${key}-bold`, linkMentions)}
        </strong>
      );
    }
    if (node.name === "i") {
      return (
        <em key={key}>
          {renderInlineNodes(node.children, `${key}-italic`, linkMentions)}
        </em>
      );
    }
    if (node.name === "u") {
      return (
        <span className="underline underline-offset-2" key={key}>
          {renderInlineNodes(node.children, `${key}-underline`, linkMentions)}
        </span>
      );
    }
    if (node.name === "s") {
      return (
        <s key={key}>
          {renderInlineNodes(node.children, `${key}-strike`, linkMentions)}
        </s>
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
          {renderInlineNodes(node.children, `${key}-mark`, linkMentions)}
        </mark>
      );
    }
    if (node.name === "color") {
      return (
        <span className={forumColorClass(node.value)} key={key}>
          {renderInlineNodes(node.children, `${key}-color`, linkMentions)}
        </span>
      );
    }
    if (node.name === "url") {
      const link = forumLinkDetails(
        node.value || forumBbcodeText(node.children),
      );
      const label = forumBbcodeText(node.children).trim() || link?.href;
      if (!link || !label) {
        return decodeForumEntities(forumBbcodeText(node.children));
      }
      return (
        <a
          className="focus-ring [overflow-wrap:anywhere] underline decoration-primary/60 underline-offset-2 transition-colors duration-100 hover:text-primary motion-reduce:transition-none"
          href={link.href}
          key={key}
          rel={link.external ? "noopener noreferrer" : undefined}
          target={link.external ? "_blank" : undefined}
        >
          {node.children.length > 0
            ? renderInlineNodes(node.children, `${key}-link`, false)
            : link.href}
          {link.external ? (
            <span className="sr-only"> (opens in a new tab)</span>
          ) : null}
        </a>
      );
    }
    if (node.name === "img") {
      return renderForumImage(node, key);
    }
    if (node.name === "br") {
      return <br key={key} />;
    }

    return (
      <Fragment key={key}>
        {decodeForumEntities(forumBbcodeText(node.children))}
      </Fragment>
    );
  });
}

function renderForumImage(node: ForumBbcodeTagNode, key: string) {
  const src = safeImageUrl(
    decodeForumEntities(forumBbcodeText(node.children).trim()),
  );
  if (!src) {
    return decodeForumEntities(forumBbcodeText(node.children));
  }
  const alt = decodeForumEntities(node.value?.slice(0, 180) ?? "");
  return (
    <figure className="my-3 max-w-full" key={key}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Forum BBCode images can be external user content. */}
      <img
        alt={alt}
        className="max-h-[32rem] max-w-full border border-row-border object-contain"
        decoding="async"
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

function renderTextWithBreaks(
  value: string,
  keyPrefix: string,
  linkMentions: boolean,
): ReactNode[] {
  return value.split("\n").flatMap((line, lineIndex, lines) => {
    const rendered = renderForumSmilies(
      line,
      `${keyPrefix}-${lineIndex}`,
      linkMentions,
    );
    return lineIndex < lines.length - 1
      ? [...rendered, <br key={`${keyPrefix}-break-${lineIndex}`} />]
      : rendered;
  });
}

function renderForumSmilies(
  text: string,
  keyPrefix: string,
  linkMentions: boolean,
): ReactNode[] {
  const pattern = /(:\)|:D|;\)|:P|:\(|:o|:cool:|:heart:)/g;
  return decodeForumEntities(text)
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const label = FORUM_SMILIES.get(part);
      if (!label) {
        if (!linkMentions) {
          return <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>;
        }
        return splitForumMentions(part).map((segment, segmentIndex) =>
          segment.kind === "mention" ? (
            <ForumLink
              className="focus-ring font-medium text-primary underline decoration-primary/45 underline-offset-2 hover:decoration-primary"
              href={`/forum/members/${encodeURIComponent(segment.username)}`}
              key={`${keyPrefix}-text-${index}-mention-${segmentIndex}`}
              prefetch
            >
              {segment.value}
            </ForumLink>
          ) : (
            <Fragment
              key={`${keyPrefix}-text-${index}-segment-${segmentIndex}`}
            >
              {segment.value}
            </Fragment>
          ),
        );
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

function forumColorClass(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (["cyan", "teal", "tiffany", "accent"].includes(normalized ?? "")) {
    return "text-accent-cyan";
  }
  if (["yellow", "canary", "gold"].includes(normalized ?? "")) {
    return "text-accent-canary";
  }
  if (["pink", "magenta", "primary"].includes(normalized ?? "")) {
    return "text-primary";
  }
  if (["muted", "gray", "grey"].includes(normalized ?? "")) {
    return "text-muted-foreground";
  }
  return "text-foreground";
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
