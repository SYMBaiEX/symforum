/* eslint-disable @next/next/no-img-element */
import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import { MarkdownContent } from "@/components/markdown-content";
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
      <article className="mx-auto max-w-5xl px-4 py-10 md:px-8 md:py-14">
        <div className="max-w-4xl">
          <p className="font-mono text-[11px] uppercase text-muted-foreground">
            Field note
          </p>
          <h1 className="mt-3 break-words text-3xl font-bold leading-[0.96] text-balance sm:text-4xl md:text-5xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
            <span>{formatDate(post.publishedAt)}</span>
            <span>{post.readingMinutes} min read</span>
            {post.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {post.excerpt}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {convexEnabled ? (
              <InteractionBar entityType="post" entityId={post.slug} />
            ) : (
              <p className="font-mono text-xs uppercase text-muted-foreground">
                Interactions enable after Convex is connected.
              </p>
            )}
          </div>

          {imageUrl ? (
            <figure className="mt-8 max-w-3xl border-y border-row-border py-4">
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

          <div className="max-w-3xl">
            <MarkdownContent content={post.body} />
            <section className="mt-14">
              <h2 className="mb-5 font-mono text-sm uppercase">Thread</h2>
              <CommentsPanel
                entityType="post"
                entityId={post.slug}
                enabled={convexEnabled}
              />
            </section>
          </div>
        </div>
      </article>
    </>
  );
}
