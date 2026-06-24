/* eslint-disable @next/next/no-img-element */
import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import { MarkdownContent } from "@/components/markdown-content";
import { Badge } from "@/components/ui/badge";
import { getBlogPost } from "@/lib/blog-data";
import { formatDate } from "@/lib/format";
import { safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  return {
    title: post?.title ?? "Post",
    description: post?.excerpt,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) {
    notFound();
  }
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const imageUrl = safeImageUrl(post.imageUrl);

  return (
    <>
      <article className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-24">
        <div className="grid gap-10 md:grid-cols-12">
          <aside className="font-mono text-xs uppercase text-muted-foreground md:col-span-3">
            <div className="sticky top-24 flex flex-col gap-3">
              <span>{formatDate(post.publishedAt)}</span>
              <span>{post.readingMinutes} min read</span>
              <div className="flex flex-wrap gap-2 pt-4">
                {post.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </aside>
          <div className="md:col-span-7">
            <h1 className="break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
              {post.title}
            </h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              {post.excerpt}
            </p>
            {imageUrl ? (
              <figure className="mt-9 border-y border-row-border py-4">
                <img
                  src={imageUrl}
                  alt={post.imageAlt ?? post.title}
                  className="aspect-[16/9] w-full object-cover"
                />
                {post.imageCredit ? (
                  <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
                    {post.imageCredit}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}
            <div className="mt-10 border-y border-row-border py-5">
              {convexEnabled ? (
                <InteractionBar entityType="post" entityId={post.slug} />
              ) : (
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Interactions enable after Convex is connected.
                </p>
              )}
            </div>
            <MarkdownContent content={post.body} />
            <section className="mt-14">
              <h2 className="mb-5 font-mono text-sm uppercase">Comments</h2>
              {convexEnabled ? (
                <CommentsPanel
                  entityType="post"
                  entityId={post.slug}
                  enabled={convexEnabled}
                />
              ) : (
                <CommentsPanel
                  entityType="post"
                  entityId={post.slug}
                  enabled={convexEnabled}
                />
              )}
            </section>
          </div>
        </div>
      </article>
    </>
  );
}
