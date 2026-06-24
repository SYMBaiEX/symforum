import { v, type Infer } from "convex/values";

export const postStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
);

export const postInputValidator = v.object({
  slug: v.optional(v.string()),
  title: v.string(),
  excerpt: v.string(),
  body: v.string(),
  tags: v.array(v.string()),
  status: postStatusValidator,
  publishedAt: v.number(),
  readingMinutes: v.number(),
  featured: v.boolean(),
  imageUrl: v.optional(v.string()),
  imageAlt: v.optional(v.string()),
  imageCredit: v.optional(v.string()),
});

export type PostInput = Infer<typeof postInputValidator>;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function titleToSlug(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function normalizePostInput(input: PostInput) {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 160) {
    throw new Error("Title must be between 3 and 160 characters");
  }

  const slug = titleToSlug(input.slug ?? title);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Slug must use lowercase words separated by dashes");
  }

  const excerpt = input.excerpt.trim();
  if (excerpt.length < 10 || excerpt.length > 500) {
    throw new Error("Excerpt must be between 10 and 500 characters");
  }

  const body = input.body.trim();
  if (body.length < 10) {
    throw new Error("Body must be at least 10 characters");
  }

  if (!Number.isFinite(input.publishedAt) || input.publishedAt <= 0) {
    throw new Error("Published date is required");
  }

  if (
    !Number.isFinite(input.readingMinutes) ||
    input.readingMinutes < 1 ||
    input.readingMinutes > 120
  ) {
    throw new Error("Reading minutes must be between 1 and 120");
  }

  const tags = Array.from(
    new Set(
      input.tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
        .slice(0, 12),
    ),
  );

  const post: {
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    tags: string[];
    status: "draft" | "published";
    publishedAt: number;
    readingMinutes: number;
    featured: boolean;
    imageUrl?: string;
    imageAlt?: string;
    imageCredit?: string;
  } = {
    slug,
    title,
    excerpt,
    body,
    tags,
    status: input.status,
    publishedAt: input.publishedAt,
    readingMinutes: Math.round(input.readingMinutes),
    featured: input.featured,
  };

  const imageUrl = cleanSafeUrl(input.imageUrl);
  const imageAlt = cleanOptional(input.imageAlt);
  const imageCredit = cleanOptional(input.imageCredit);
  if (imageUrl) {
    post.imageUrl = imageUrl;
  }
  if (imageAlt) {
    post.imageAlt = imageAlt;
  }
  if (imageCredit) {
    post.imageCredit = imageCredit;
  }

  return post;
}

function cleanOptional(value: string | undefined) {
  const clean = value?.trim();
  return clean && clean.length > 0 ? clean : undefined;
}

function cleanSafeUrl(value: string | undefined) {
  const clean = cleanOptional(value);
  if (!clean) {
    return undefined;
  }
  try {
    const url = new URL(clean);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Fall through to the validation error below.
  }
  throw new Error("Image URL must be an http or https URL");
}
