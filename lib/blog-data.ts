import { blogPosts, getPost, type BlogPost } from "@/lib/content";
import { convexRefs, type ConvexPostRecord } from "@/lib/convex-refs";
import { ConvexHttpClient } from "convex/browser";

function client() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? new ConvexHttpClient(url) : null;
}

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
    body: post.body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
  };
}

export async function getPublishedPosts() {
  const convex = client();
  if (convex === null) {
    return blogPosts;
  }

  try {
    const posts = await convex.query(convexRefs.posts.listPublished, {});
    return posts.map(toBlogPost);
  } catch (error) {
    console.warn("Falling back to static posts", error);
    return blogPosts;
  }
}

export async function getFeaturedPost() {
  const convex = client();
  if (convex === null) {
    return blogPosts.find((post) => post.featured) ?? blogPosts[0] ?? null;
  }

  try {
    const post = await convex.query(convexRefs.posts.featured, {});
    if (post !== null) {
      return toBlogPost(post);
    }
    const posts = await convex.query(convexRefs.posts.listPublished, {});
    return posts[0] ? toBlogPost(posts[0]) : null;
  } catch (error) {
    console.warn("Falling back to static featured post", error);
    return blogPosts.find((post) => post.featured) ?? blogPosts[0] ?? null;
  }
}

export async function getBlogPost(slug: string) {
  const convex = client();
  if (convex === null) {
    return getPost(slug);
  }

  try {
    const post = await convex.query(convexRefs.posts.getBySlug, { slug });
    return post === null ? null : toBlogPost(post);
  } catch (error) {
    console.warn("Falling back to static post lookup", error);
    return getPost(slug);
  }
}
