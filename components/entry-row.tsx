/* eslint-disable @next/next/no-img-element */
import { BlogPost } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function EntryRow({
  post,
  divided = true,
  compact = false,
}: {
  post: BlogPost;
  divided?: boolean;
  compact?: boolean;
}) {
  const imageUrl = safeImageUrl(post.imageUrl);

  return (
    <Link
      href={`/blog/${post.slug}`}
      className={cn(
        "focus-ring group grid gap-3 transition-colors hover:bg-muted/45 md:items-center md:px-3",
        imageUrl
          ? "md:grid-cols-[8.25rem_7.5rem_minmax(0,1fr)_4.5rem]"
          : "md:grid-cols-[8.25rem_minmax(0,1fr)_4.5rem]",
        compact ? "py-4 md:py-4" : "py-7",
        divided ? "border-t border-row-border" : null,
      )}
    >
      <div
        className={cn(
          "font-mono uppercase text-muted-foreground",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {formatDate(post.publishedAt)}
      </div>
      {imageUrl ? (
        <div className="w-full max-w-[7.5rem]">
          <img
            src={imageUrl}
            alt={post.imageAlt ?? post.title}
            className="h-[5.5rem] w-full border border-row-border object-cover"
          />
        </div>
      ) : null}
      <div className="min-w-0">
        <h3
          className={cn(
            "font-semibold leading-tight",
            compact ? "text-lg md:text-xl" : "text-xl md:text-2xl",
          )}
        >
          {post.title}
        </h3>
      </div>
      <div
        className={cn(
          "flex items-start md:justify-end",
          compact ? "gap-1.5" : "gap-2",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center gap-1 font-mono uppercase text-muted-foreground transition-colors group-hover:text-foreground",
            compact ? "text-[11px]" : "text-xs",
          )}
        >
          {post.readingMinutes} min <ArrowUpRight />
        </span>
      </div>
    </Link>
  );
}
