import { blogPosts, getPost, type BlogPost } from "@/lib/content";
import { convexRefs, type ConvexPostRecord } from "@/lib/convex-refs";
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

/** The homepage's "Latest blog" slot always follows publication time. */
export const getLatestPost = cache(async function getLatestPost() {
  const convex = getServerConvexClient();
  if (convex === null) {
    return blogPosts[0] ?? null;
  }

  try {
    // Deliberately bypass the shared editorial cache: a successful publish must
    // be visible in the homepage's latest slot on its very next request.
    const posts = await convex.query(convexRefs.posts.listPublished, {});
    return posts[0] ? toBlogPost(posts[0]) : null;
  } catch (error) {
    console.warn("Falling back to static latest post", error);
    return blogPosts[0] ?? null;
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
