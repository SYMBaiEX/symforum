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
        "focus-ring group grid gap-4 transition-colors hover:bg-muted/45 md:grid-cols-12 md:px-3",
        compact ? "py-4 md:py-5" : "py-7",
        divided ? "border-t border-row-border" : null,
      )}
    >
      <div
        className={cn(
          "font-mono uppercase text-muted-foreground md:col-span-2",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {formatDate(post.publishedAt)}
      </div>
      {imageUrl ? (
        <div className="md:col-span-2">
          <img
            src={imageUrl}
            alt={post.imageAlt ?? post.title}
            className="aspect-[4/3] w-full border border-row-border object-cover"
          />
        </div>
      ) : null}
      <div className={cn(imageUrl ? "md:col-span-5" : "md:col-span-7")}>
        <h3
          className={cn(
            "font-semibold leading-tight text-balance",
            compact ? "text-lg md:text-xl" : "text-xl md:text-2xl",
          )}
        >
          {post.title}
        </h3>
      </div>
      <div
        className={cn(
          "flex items-start md:col-span-3 md:justify-end",
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
