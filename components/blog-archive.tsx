import { BlogPostFilter } from "@/components/blog-post-filter";
import {
  ForumBodyGrid,
  ForumPageHeader,
  ForumSectionHeader,
} from "@/components/forum/forum-layout-primitives";
import type { BlogPostSummary } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { newsletterSiteUrl } from "@/lib/site-urls";
import { ArrowUpRight, BookOpen, Rss } from "lucide-react";
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
    <section className="page-frame page-frame-dense mx-auto w-full max-w-[1440px]">
      <ForumPageHeader
        title="Blog"
        description="Essays and field notes by Austin Hamilton on software, AI systems, and engineering practice."
        actions={
          <Link
            href="/feed/blog.xml"
            className="forum-primary-action focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Rss aria-hidden="true" className="size-4" />
            Follow via RSS
          </Link>
        }
      />

      {featuredPost ? (
        <article
          id="blog-featured"
          className="forum-panel mt-4 scroll-mt-24 p-4 md:p-5"
        >
          <div className="grid gap-4 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-5">
            <div className="flex gap-3 border-b border-border pb-3 md:block md:border-b-0 md:border-r md:pb-0 md:pr-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BookOpen aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
                  {featuredPost.featured ? "Featured post" : "Latest post"}
                </p>
                <time
                  className="mt-1 block font-mono text-[10px] uppercase text-muted-foreground"
                  dateTime={featuredPost.publishedAt}
                >
                  {formatDate(featuredPost.publishedAt)}
                </time>
                <p className="mt-2 font-mono text-[10px] uppercase text-muted-foreground">
                  {featuredPost.readingMinutes} min read
                </p>
              </div>
            </div>
            <div className="min-w-0 self-center">
              <h2 className="max-w-4xl text-xl font-bold leading-tight tracking-tight md:text-2xl">
                {featuredPost.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {featuredPost.excerpt}
              </p>
              <Link
                className="forum-primary-action focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
                href={`/blog/${featuredPost.slug}`}
              >
                Read the post
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
        </article>
      ) : null}

      <ForumBodyGrid
        mobileSidebarLabel="Blog context"
        sidebar={
          <div className="space-y-3">
            <section className="forum-panel p-4">
              <ForumSectionHeader title="About the blog" />
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                Field notes from building software and studying the systems
                around it.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3">
                <div>
                  <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                    Published
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tracking-tight">
                    {posts.length}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-muted-foreground">
                    Topics
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tracking-tight">
                    {tags.length}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="forum-panel p-4">
              <ForumSectionHeader title="Keep reading" />
              <p className="mt-2 text-sm leading-5 text-muted-foreground">
                Get new posts in your feed, or follow the daily signals and
                weekly field notes.
              </p>
              <div className="mt-3 grid gap-2">
                <Link
                  className="forum-action-pill focus-ring justify-start"
                  href="/feed/blog.xml"
                >
                  <Rss aria-hidden="true" className="size-4" />
                  Blog RSS feed
                  <ArrowUpRight
                    aria-hidden="true"
                    className="ml-auto size-3.5"
                  />
                </Link>
                <Link
                  className="forum-action-pill focus-ring justify-start"
                  href={newsletterSiteUrl("/newsletter#newsletter-subscribe")}
                >
                  <BookOpen aria-hidden="true" className="size-4" />
                  SYMBaiEX Newsletter
                  <ArrowUpRight
                    aria-hidden="true"
                    className="ml-auto size-3.5"
                  />
                </Link>
              </div>
            </section>
          </div>
        }
      >
        <section
          id="blog-archive"
          aria-labelledby="blog-archive-heading"
          className="forum-panel scroll-mt-24 overflow-hidden !p-0"
        >
          <ForumSectionHeader title="More posts" id="blog-archive-heading">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              Newest first · {archivePosts.length} entries
            </span>
          </ForumSectionHeader>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Showing {visiblePosts.length} of {posts.length} posts
              {selectedTag ? ` · ${selectedTag}` : ""}
            </p>
            <BlogPostFilter
              tags={tags}
              selectedTag={selectedTag}
              totalPosts={posts.length}
            />
          </div>

          {archivePosts.length > 0 ? (
            <div className="divide-y divide-border border-t border-border">
              {archivePosts.map((post) => (
                <ArchiveEntry key={post.slug} post={post} />
              ))}
            </div>
          ) : (
            <p className="border-t border-border px-4 py-4 text-sm leading-6 text-muted-foreground">
              {featuredPost
                ? "You’re viewing the featured post. More posts will appear here."
                : selectedTag
                  ? "No published posts match this topic."
                  : "No published posts yet."}
            </p>
          )}

          {posts.length >= 50 ? (
            <p className="border-t border-border px-4 py-3 font-mono text-[10px] uppercase text-muted-foreground">
              Showing the latest 50 posts
            </p>
          ) : null}
        </section>
      </ForumBodyGrid>
    </section>
  );
}

function ArchiveEntry({ post }: { post: BlogPostSummary }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      prefetch
      className="group grid gap-2 px-4 py-3 transition-colors hover:bg-muted/35 md:grid-cols-[minmax(0,1fr)_8.5rem] md:items-center"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
          <time dateTime={post.publishedAt}>
            {formatDate(post.publishedAt)}
          </time>
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes} min read</span>
          {post.featured ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-primary">Featured</span>
            </>
          ) : null}
        </span>
        <span className="mt-1 block text-sm font-semibold leading-5 transition-colors group-hover:text-primary">
          {post.title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {post.excerpt}
        </span>
      </span>
      <span className="hidden items-center justify-end gap-1 text-xs font-medium text-muted-foreground group-hover:text-primary md:flex">
        Read post
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </span>
    </Link>
  );
}
