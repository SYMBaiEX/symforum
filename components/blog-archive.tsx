import { BlogPostFilter } from "@/components/blog-post-filter";
import type { BlogPostSummary } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { safeImageUrl } from "@/lib/safe-url";
import { ArrowUpRight, Rss } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

type BlogTag = { count: number; name: string };

export function BlogArchive({
  posts,
  tags,
  selectedTag,
  visiblePosts,
}: {
  posts: BlogPostSummary[];
  tags: BlogTag[];
  selectedTag?: string;
  visiblePosts: BlogPostSummary[];
}) {
  const featuredPost =
    visiblePosts.find((post) => post.featured) ?? visiblePosts[0] ?? null;
  const archivePosts = featuredPost
    ? visiblePosts.filter((post) => post.slug !== featuredPost.slug)
    : [];

  return (
    <section className="page-frame page-frame-spacious">
      <div className="grid gap-8 border-b border-row-border pb-8 md:grid-cols-12 md:items-end md:pb-10">
        <div className="md:col-span-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Field notes / {String(posts.length).padStart(2, "0")} published
          </p>
          <h1 className="mt-5 max-w-4xl text-balance text-5xl font-semibold leading-[0.94] tracking-[-0.045em] sm:text-6xl md:text-7xl">
            Systems, <span className="text-primary">in practice.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            Essays and field notes by Austin Hamilton about software, AI
            systems, and engineering practice.
          </p>
        </div>
        <aside className="border-t border-row-border pt-4 md:col-span-4 md:border-l md:border-t-0 md:pb-1 md:pl-6 md:pt-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            An open notebook
          </p>
          <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            Notes from building software and studying the systems around it.
          </p>
          <div className="mt-5 flex items-baseline gap-3 border-t border-row-border pt-3">
            <span className="font-mono text-3xl tabular-nums">
              {String(posts.length).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              published entries
            </span>
          </div>
          <a
            href="/feed/blog.xml"
            className="focus-ring mt-4 inline-flex min-h-10 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Rss aria-hidden="true" className="size-4" />
            Subscribe via RSS
          </a>
        </aside>
      </div>

      <div className="mt-7 grid gap-3 border-y border-row-border py-3 md:grid-cols-12 md:items-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground md:col-span-4">
          Archive / {selectedTag ?? "all subjects"}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 md:col-span-8">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Showing {visiblePosts.length} of {posts.length} entries
          </p>
          <BlogPostFilter
            tags={tags}
            selectedTag={selectedTag}
            totalPosts={posts.length}
          />
        </div>
      </div>

      {featuredPost ? (
        <>
          <section aria-labelledby="blog-feature-heading" className="mt-9">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <h2 id="blog-feature-heading" className="text-primary">
                {featuredPost.featured ? "Selected note" : "Latest note"}
              </h2>
              <time dateTime={featuredPost.publishedAt}>
                {formatDate(featuredPost.publishedAt)}
              </time>
            </div>
            <FeaturedEntry post={featuredPost} />
          </section>

          {archivePosts.length > 0 ? (
            <section aria-labelledby="blog-archive-heading" className="mt-12">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-row-border pb-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    The record
                  </p>
                  <h2
                    id="blog-archive-heading"
                    className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl"
                  >
                    More field notes
                  </h2>
                </div>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {String(archivePosts.length).padStart(2, "0")} entries
                </span>
              </div>
              <div>
                {archivePosts.map((post, index) => (
                  <ArchiveEntry
                    key={post.slug}
                    index={index + 2}
                    post={post}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {posts.length >= 50 ? (
            <p className="mt-6 font-mono text-[10px] uppercase text-muted-foreground">
              Showing the latest 50 posts
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-9 border-y border-row-border py-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Archive / 00
          </p>
          <p className="mt-3 text-lg font-medium">No published posts yet.</p>
        </div>
      )}
    </section>
  );
}

function FeaturedEntry({ post }: { post: BlogPostSummary }) {
  const imageUrl = safeImageUrl(post.imageUrl);

  return (
    <Link
      href={`/blog/${post.slug}`}
      prefetch
      className="focus-ring group grid overflow-hidden border border-row-border transition-colors hover:bg-muted/35 md:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.92fr)]"
    >
      <div className="relative aspect-[16/10] min-h-56 overflow-hidden border-b border-row-border bg-muted md:aspect-auto md:min-h-[25rem] md:border-b-0 md:border-r">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            fill
            fetchPriority="high"
            loading="eager"
            sizes="(max-width: 768px) calc(100vw - 2rem), 58vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full min-h-56 flex-col justify-between bg-background p-5 md:min-h-[25rem] md:p-7"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              SYMBaiEX / field notes
            </span>
            <div className="flex items-end justify-between border-t border-row-border pt-4">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                No. 01
              </span>
              <span className="font-mono text-7xl leading-none tracking-[-0.08em] text-primary md:text-8xl">
                01
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-64 flex-col justify-between gap-8 p-5 md:min-h-[25rem] md:p-7">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
            {post.featured ? "Editor’s selection" : "Latest dispatch"}
          </p>
          <h2 className="mt-4 text-3xl font-semibold leading-[1.04] tracking-[-0.025em] md:text-4xl">
            {post.title}
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
            {post.excerpt}
          </p>
        </div>
        <div>
          <div className="flex flex-wrap gap-2">
            {post.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="border border-row-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-row-border pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>{post.readingMinutes} min read</span>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              Read note
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ArchiveEntry({
  index,
  post,
}: {
  index: number;
  post: BlogPostSummary;
}) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      prefetch
      className="focus-ring group grid gap-x-4 gap-y-3 border-b border-row-border py-5 transition-colors hover:bg-muted/35 md:grid-cols-[3rem_7rem_minmax(0,1fr)_auto] md:items-start md:px-2"
    >
      <span className="hidden font-mono text-[10px] tabular-nums text-primary md:block">
        {String(index).padStart(2, "0")}
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
        <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
        <span>{post.readingMinutes} min</span>
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-tight tracking-tight group-hover:text-primary md:text-xl">
          {post.title}
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {post.excerpt}
        </p>
        {post.tags.length > 0 ? (
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
            {post.tags.slice(0, 4).join(" / ")}
          </p>
        ) : null}
      </div>
      <ArrowUpRight
        aria-hidden="true"
        className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground md:block"
      />
    </Link>
  );
}
