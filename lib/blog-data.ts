import {
  blogPosts,
  getPost,
  type BlogPost,
  type BlogPostSummary,
} from "@/lib/content";
import {
  convexRefs,
  type ConvexPostRecord,
  type ConvexPostSummaryRecord,
} from "@/lib/convex-refs";
import { readThroughServerCache } from "@/lib/server-cache";
import { getServerConvexClient } from "@/lib/server-convex";
import { cache } from "react";

const BLOG_DATA_TTL_MS = 30 * 1000;

function toBlogPost(post: ConvexPostRecord): BlogPost {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: new Date(post.publishedAt).toISOString().slice(0, 10),
    readingMinutes: post.readingMinutes,
    tags: post.tags,
    featured: post.featured,
    imageUrl: post.imageUrl,
    imageAlt: post.imageAlt,
    imageCredit: post.imageCredit,
    body: post.body,
  };
}

function toBlogPostSummary(post: ConvexPostSummaryRecord): BlogPostSummary {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    publishedAt: new Date(post.publishedAt).toISOString().slice(0, 10),
    readingMinutes: post.readingMinutes,
    tags: post.tags,
    featured: post.featured,
    imageUrl: post.imageUrl,
    imageAlt: post.imageAlt,
    imageCredit: post.imageCredit,
  };
}

export const getPublishedPosts = cache(async function getPublishedPosts() {
  const convex = getServerConvexClient();
  if (convex === null) {
    return blogPosts;
  }

  try {
    const posts = await readThroughServerCache(
      "posts:published",
      BLOG_DATA_TTL_MS,
      () => convex.query(convexRefs.posts.listPublished, {}),
    );
    return posts.map(toBlogPost);
  } catch (error) {
    console.warn("Falling back to static posts", error);
    return blogPosts;
  }
});

/**
 * List surfaces deliberately request a compact projection. Keep
 * `getPublishedPosts` for callers that genuinely need article bodies.
 */
export const getPublishedPostSummaries = cache(
  async function getPublishedPostSummaries(): Promise<BlogPostSummary[]> {
    const convex = getServerConvexClient();
    if (convex === null) {
      return blogPosts.map(({ body: _body, ...post }) => post);
    }

    try {
      const posts = await readThroughServerCache(
        "posts:published-summaries",
        BLOG_DATA_TTL_MS,
        () => convex.query(convexRefs.posts.listPublishedSummaries, {}),
      );
      return posts.map(toBlogPostSummary);
    } catch (error) {
      console.warn("Falling back to static post summaries", error);
      return blogPosts.map(({ body: _body, ...post }) => post);
    }
  },
);

export const getFeaturedPost = cache(async function getFeaturedPost() {
  const convex = getServerConvexClient();
  if (convex === null) {
    return blogPosts.find((post) => post.featured) ?? blogPosts[0] ?? null;
  }

  try {
    const post = await readThroughServerCache(
      "posts:featured",
      BLOG_DATA_TTL_MS,
      () => convex.query(convexRefs.posts.featured, {}),
    );
    if (post !== null) {
      return toBlogPost(post);
    }
    const posts = await readThroughServerCache(
      "posts:published",
      BLOG_DATA_TTL_MS,
      () => convex.query(convexRefs.posts.listPublished, {}),
    );
    return posts[0] ? toBlogPost(posts[0]) : null;
  } catch (error) {
    console.warn("Falling back to static featured post", error);
    return blogPosts.find((post) => post.featured) ?? blogPosts[0] ?? null;
  }
});

/** The homepage's "Latest Blogs" list always follows publication time. */
export const getLatestPosts = cache(async function getLatestPosts(limit = 5) {
  const boundedLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  const convex = getServerConvexClient();
  if (convex === null) {
    return blogPosts.slice(0, boundedLimit);
  }

  try {
    // Deliberately bypass the shared editorial cache: a successful publish must
    // be visible in the homepage's latest list on its very next request.
    const posts = await convex.query(
      convexRefs.posts.listPublishedSummaries,
      {},
    );
    return posts.slice(0, boundedLimit).map(toBlogPostSummary);
  } catch (error) {
    console.warn("Falling back to static latest posts", error);
    return blogPosts.slice(0, boundedLimit);
  }
});

export const getBlogPost = cache(async function getBlogPost(slug: string) {
  const convex = getServerConvexClient();
  if (convex === null) {
    return getPost(slug);
  }

  try {
    const post = await readThroughServerCache(
      `posts:slug:${slug}`,
      BLOG_DATA_TTL_MS,
      () => convex.query(convexRefs.posts.getBySlug, { slug }),
    );
    return post === null ? null : toBlogPost(post);
  } catch (error) {
    console.warn("Falling back to static post lookup", error);
    return getPost(slug);
  }
});
