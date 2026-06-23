import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { SiteShell } from "@/components/site-shell";
import { Badge } from "@/components/ui/badge";
import { getPost, blogPosts } from "@/lib/content";
import { formatDate } from "@/lib/format";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
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
  const post = getPost(slug);
  if (!post) {
    notFound();
  }
  const convexEnabled = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <SiteShell>
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
            <h1 className="break-words text-5xl font-bold leading-[0.92] text-balance md:text-7xl lg:text-8xl">
              {post.title}
            </h1>
            <p className="mt-7 text-xl leading-8 text-muted-foreground">
              {post.excerpt}
            </p>
            <div className="mt-10 border-y border-row-border py-5">
              {convexEnabled ? (
                <ConvexClientProvider>
                  <InteractionBar entityType="post" entityId={post.slug} />
                </ConvexClientProvider>
              ) : (
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Interactions enable after Convex is connected.
                </p>
              )}
            </div>
            <div className="mt-10 flex max-w-none flex-col gap-7">
              {post.body.map((paragraph) => (
                <p key={paragraph} className="text-lg leading-8">
                  {paragraph}
                </p>
              ))}
            </div>
            <section className="mt-14">
              <h2 className="mb-5 font-mono text-sm uppercase">Comments</h2>
              {convexEnabled ? (
                <ConvexClientProvider>
                  <CommentsPanel
                    entityType="post"
                    entityId={post.slug}
                    enabled={convexEnabled}
                  />
                </ConvexClientProvider>
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
    </SiteShell>
  );
}
