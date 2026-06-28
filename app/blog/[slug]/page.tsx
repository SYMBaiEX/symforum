import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import { MarkdownContent } from "@/components/markdown-content";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { getBlogPost } from "@/lib/blog-data";
import { formatDate } from "@/lib/format";
import { isLocalImageUrl, safeImageUrl } from "@/lib/safe-url";
import type { Metadata } from "next";
import Image from "next/image";
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
      <article className="page-frame">
        <div className="page-content">
          <h1 className="page-title mt-3">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
            <span>{formatDate(post.publishedAt)}</span>
            <span>{post.readingMinutes} min read</span>
            {post.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="page-lede mt-5">
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
              <div className="relative aspect-[16/9] w-full overflow-hidden">
                <Image
                  src={imageUrl}
                  alt={post.imageAlt ?? post.title}
                  fill
                  priority
                  sizes="(max-width: 768px) calc(100vw - 2rem), 48rem"
                  unoptimized={isLocalImageUrl(imageUrl)}
                  className="object-cover"
                />
              </div>
              {post.imageCredit ? (
                <figcaption className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
                  {post.imageCredit}
                </figcaption>
              ) : null}
            </figure>
          ) : null}

          <div className="page-content-readable">
            <MarkdownContent content={post.body} />
            <section className="mt-12 grid gap-3 sm:grid-cols-[1fr_minmax(18rem,26rem)] sm:items-center">
              <div>
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Newsletter
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  Get the next note
                </h2>
              </div>
              <NewsletterSignup source={`post-${post.slug}`} />
            </section>
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
