import { MarkdownContent } from "@/components/markdown-content";

/**
 * Keeps public content useful when a browser or crawler does not execute the
 * forum's interactive Convex widgets. The interactive client component still
 * owns mutations, presence, and live updates; this fallback owns readable
 * content only and is ignored by browsers with scripting enabled.
 */
export function NoScriptFallback({ content }: { content: string }) {
  return (
    <noscript>
      <section className="page-frame page-frame-dense">
        <MarkdownContent content={content} />
      </section>
    </noscript>
  );
}
