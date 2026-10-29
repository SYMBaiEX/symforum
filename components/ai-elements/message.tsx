"use client";

import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function MessageResponse({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn("max-w-none text-sm leading-6 text-foreground", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Replies can contain untrusted source text. Never auto-fetch model URLs.
          img: ({ alt }) => (
            <span>{alt ? `[Image: ${alt}]` : "[Image omitted]"}</span>
          ),
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="underline decoration-primary/60 underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          code: ({ children, className, ...props }) => (
            <code
              {...props}
              className={cn(
                "font-mono text-[0.9em] text-foreground",
                className,
              )}
            >
              {children}
            </code>
          ),
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-xl font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>
          ),
          li: ({ children }) => <li className="my-1">{children}</li>,
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          p: ({ children }) => <p className="my-2">{children}</p>,
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto bg-muted/20 p-3">
              {children}
            </pre>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
