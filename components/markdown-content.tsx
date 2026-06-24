import { safeExternalUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSlug, rehypeKatex]}
        components={{
          a({ href, children }) {
            const cleanHref = normalizeMarkdownHref(href);
            if (cleanHref.startsWith("/")) {
              return <Link href={cleanHref}>{children}</Link>;
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
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
