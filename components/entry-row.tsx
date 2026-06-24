/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { BlogPost } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function EntryRow({ post }: { post: BlogPost }) {
  const imageUrl = safeImageUrl(post.imageUrl);

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="focus-ring group grid gap-4 border-t border-row-border py-7 transition-colors hover:bg-muted/45 md:grid-cols-12 md:px-3"
    >
      <div className="font-mono text-xs uppercase text-muted-foreground md:col-span-2">
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
        <h3 className="text-2xl font-semibold leading-tight text-balance">
          {post.title}
        </h3>
        <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
          {post.excerpt}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2 md:col-span-3 md:justify-end">
        {post.tags.map((tag) => (
          <Badge key={tag} variant="outline" className="font-mono uppercase">
            {tag}
          </Badge>
        ))}
        <span className="inline-flex items-center gap-1 font-mono text-xs uppercase text-muted-foreground transition-colors group-hover:text-foreground">
          {post.readingMinutes} min <ArrowUpRight />
        </span>
      </div>
    </Link>
  );
}
