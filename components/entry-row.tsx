import { BlogPost } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { isLocalImageUrl, safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function EntryRow({
  post,
  divided = true,
  compact = false,
  priority = false,
}: {
  post: BlogPost;
  divided?: boolean;
  compact?: boolean;
  priority?: boolean;
}) {
  const imageUrl = safeImageUrl(post.imageUrl);

  return (
    <Link
      href={`/blog/${post.slug}`}
      prefetch
      className={cn(
        "focus-ring group grid grid-cols-[minmax(0,1fr)_auto] gap-3 transition-colors hover:bg-muted/45 md:items-center md:px-3",
        "[content-visibility:auto] [contain-intrinsic-size:0_7rem]",
        imageUrl
          ? "md:grid-cols-[8.25rem_7.5rem_minmax(0,1fr)_4.5rem]"
          : "md:grid-cols-[8.25rem_minmax(0,1fr)_4.5rem]",
        compact ? "py-4 md:py-4" : "py-7",
        divided ? "border-t border-row-border" : null,
      )}
    >
      <div
        className={cn(
          "col-start-1 row-start-1 font-mono uppercase text-muted-foreground md:col-start-auto md:row-start-auto",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {formatDate(post.publishedAt)}
      </div>
      {imageUrl ? (
        <div className="relative col-span-2 h-[5.5rem] w-full max-w-[7.5rem] md:col-span-1">
          <Image
            src={imageUrl}
            alt={post.imageAlt ?? post.title}
            fill
            priority={priority}
            sizes="7.5rem"
            unoptimized={isLocalImageUrl(imageUrl)}
            className="h-[5.5rem] w-full border border-row-border object-cover"
          />
        </div>
      ) : null}
      <div className="col-span-2 min-w-0 md:col-span-1">
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
          "col-span-2 flex items-start justify-end md:col-span-1",
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
