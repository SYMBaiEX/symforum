import { CommentsPanel } from "@/components/comments-panel";
import { InteractionBar } from "@/components/interaction-bar";
import { MarkdownContent } from "@/components/markdown-content";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { StructuredData } from "@/components/structured-data";
import { Button } from "@/components/ui/button";
import { getBlogPost } from "@/lib/blog-data";
import { formatDate } from "@/lib/format";
import { safeImageUrl } from "@/lib/safe-url";
import {
  breadcrumbStructuredData,
  compactSeoTitle,
  AUTHOR_NAME,
  AUTHOR_URL,
  SITE_BRAND,
} from "@/lib/seo";
import { primarySiteUrl } from "@/lib/site-urls";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  const imageUrl = safeImageUrl(post?.imageUrl);
  const canonical = post
    ? primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`)
    : primarySiteUrl(`/blog/${encodeURIComponent(slug)}`);
  return {
    title: {
      absolute: compactSeoTitle(post?.title ?? "Post", SITE_BRAND),
    },
    description: post?.excerpt,
    alternates: { canonical },
    authors: [{ name: AUTHOR_NAME, url: AUTHOR_URL }],
    robots: post ? undefined : { index: false, follow: false },
    openGraph: post
      ? {
          type: "article",
          url: canonical,
          title: post.title,
          description: post.excerpt,
          publishedTime: post.publishedAt,
          authors: [AUTHOR_URL],
          tags: post.tags,
          images: [
            {
              url: imageUrl ?? `${primarySiteUrl("/")}opengraph-image`,
              alt: post.imageAlt ?? post.title,
            },
          ],
        }
      : undefined,
    twitter: post
      ? {
          card: "summary_large_image",
          title: post.title,
          description: post.excerpt,
          images: [imageUrl ?? `${primarySiteUrl("/")}opengraph-image`],
        }
      : undefined,
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
  const canonical = primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`);

  return (
    <>
      <article className="page-frame">
        <StructuredData
          data={[
            {
              "@type": "Article",
              "@id": `${canonical}#article`,
              headline: post.title,
              description: post.excerpt,
              datePublished: post.publishedAt,
              dateModified: post.publishedAt,
              author: { "@type": "Person", name: AUTHOR_NAME, url: AUTHOR_URL },
              image: imageUrl ?? undefined,
              mainEntityOfPage: { "@id": canonical },
              keywords: post.tags,
            },
            breadcrumbStructuredData([
              { name: "Home", url: primarySiteUrl("/") },
              { name: "Blog", url: primarySiteUrl("/blog") },
              {
                name: post.title,
                url: canonical,
              },
            ]),
          ]}
        />
        <div className="page-content">
          <h1 className="page-title mt-3">{post.title}</h1>
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
            <span>{formatDate(post.publishedAt)}</span>
            <span>{post.readingMinutes} min read</span>
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {tag}
              </Link>
            ))}
          </div>
          <p className="page-lede mt-5">{post.excerpt}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/blog" prefetch>
                Back to blog
              </Link>
            </Button>
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
                  fetchPriority="high"
                  loading="eager"
                  sizes="(max-width: 768px) calc(100vw - 2rem), 48rem"
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
