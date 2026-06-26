import { v, type Infer } from "convex/values";
import { titleToSlug } from "./postModel";

const pageStatusValidator = v.union(v.literal("draft"), v.literal("published"));

export const sitePageInputValidator = v.object({
  slug: v.optional(v.string()),
  title: v.string(),
  subtitle: v.string(),
  heroHeading: v.string(),
  heroBody: v.string(),
  body: v.string(),
  status: pageStatusValidator,
  showImage: v.optional(v.boolean()),
  imageUrl: v.optional(v.string()),
  imageAlt: v.optional(v.string()),
  imageCredit: v.optional(v.string()),
});

export const portfolioProjectInputValidator = v.object({
  slug: v.optional(v.string()),
  name: v.string(),
  type: v.string(),
  role: v.string(),
  timeframe: v.string(),
  summary: v.string(),
  problem: v.string(),
  approach: v.string(),
  outcome: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("published"),
    v.literal("archived"),
  ),
  order: v.number(),
  tags: v.array(v.string()),
  imageUrl: v.optional(v.string()),
  imageAlt: v.optional(v.string()),
  homepageUrl: v.optional(v.string()),
  repoUrl: v.optional(v.string()),
  writeupUrl: v.optional(v.string()),
});

export type SitePageInput = Infer<typeof sitePageInputValidator>;
export type PortfolioProjectInput = Infer<
  typeof portfolioProjectInputValidator
>;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSitePageInput(input: SitePageInput) {
  const title = cleanRequired(input.title, "Title", 2, 120);
  const slug = cleanSlug(input.slug ?? title);
  const subtitle = cleanRequired(input.subtitle, "Subtitle", 2, 180);
  const heroHeading = cleanRequired(input.heroHeading, "Hero heading", 2, 160);
  const heroBody = cleanRequired(input.heroBody, "Hero body", 10, 700);
  const body = cleanRequired(input.body, "Body", 10, 20000);

  const page: {
    slug: string;
    title: string;
    subtitle: string;
    heroHeading: string;
    heroBody: string;
    body: string;
    status: "draft" | "published";
    updatedAt: number;
    showImage?: boolean;
    imageUrl?: string;
    imageAlt?: string;
    imageCredit?: string;
  } = {
    slug,
    title,
    subtitle,
    heroHeading,
    heroBody,
    body,
    status: input.status,
    updatedAt: Date.now(),
  };

  if (input.showImage === true) {
    page.showImage = true;
  }

  const imageUrl = cleanSafeUrl(input.imageUrl, "Image URL");
  const imageAlt = cleanOptional(input.imageAlt, 220);
  const imageCredit = cleanOptional(input.imageCredit, 220);
  if (imageUrl) {
    page.imageUrl = imageUrl;
  }
  if (imageAlt) {
    page.imageAlt = imageAlt;
  }
  if (imageCredit) {
    page.imageCredit = imageCredit;
  }

  return page;
}

export function normalizePortfolioProjectInput(input: PortfolioProjectInput) {
  const name = cleanRequired(input.name, "Project name", 2, 120);
  const slug = cleanSlug(input.slug ?? name);
  const order = Math.round(input.order);
  if (!Number.isFinite(order) || order < 1 || order > 9999) {
    throw new Error("Project order must be between 1 and 9999");
  }

  const project: {
    slug: string;
    name: string;
    type: string;
    role: string;
    timeframe: string;
    summary: string;
    problem: string;
    approach: string;
    outcome: string;
    status: "draft" | "published" | "archived";
    order: number;
    tags: string[];
    imageUrl?: string;
    imageAlt?: string;
    homepageUrl?: string;
    repoUrl?: string;
    writeupUrl?: string;
  } = {
    slug,
    name,
    type: cleanRequired(input.type, "Project type", 2, 80),
    role: cleanRequired(input.role, "Project role", 2, 180),
    timeframe: cleanRequired(input.timeframe, "Timeframe", 2, 80),
    summary: cleanRequired(input.summary, "Summary", 10, 700),
    problem: cleanRequired(input.problem, "Problem", 2, 700),
    approach: cleanRequired(input.approach, "Approach", 2, 900),
    outcome: cleanRequired(input.outcome, "Outcome", 2, 900),
    status: input.status,
    order,
    tags: cleanTags(input.tags),
  };

  const imageUrl = cleanSafeUrl(input.imageUrl, "Image URL");
  const imageAlt = cleanOptional(input.imageAlt, 220);
  const homepageUrl = cleanSafeUrl(input.homepageUrl, "Homepage URL");
  const repoUrl = cleanSafeUrl(input.repoUrl, "Repo URL");
  const writeupUrl = cleanSafeUrl(input.writeupUrl, "Writeup URL");
  if (imageUrl) {
    project.imageUrl = imageUrl;
  }
  if (imageAlt) {
    project.imageAlt = imageAlt;
  }
  if (homepageUrl) {
    project.homepageUrl = homepageUrl;
  }
  if (repoUrl) {
    project.repoUrl = repoUrl;
  }
  if (writeupUrl) {
    project.writeupUrl = writeupUrl;
  }

  return project;
}

function cleanRequired(
  value: string,
  label: string,
  minLength: number,
  maxLength: number,
) {
  const clean = value.trim();
  if (clean.length < minLength || clean.length > maxLength) {
    throw new Error(
      `${label} must be between ${minLength} and ${maxLength} characters`,
    );
  }
  return clean;
}

function cleanSlug(value: string) {
  const slug = titleToSlug(value);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Slug must use lowercase words separated by dashes");
  }
  return slug;
}

function cleanTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
        .slice(0, 12),
    ),
  );
}

function cleanOptional(value: string | undefined, maxLength: number) {
  const clean = value?.trim();
  if (!clean) {
    return undefined;
  }
  return clean.slice(0, maxLength);
}

function cleanSafeUrl(value: string | undefined, label: string) {
  const clean = value?.trim();
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
  throw new Error(`${label} must be an http or https URL`);
}
