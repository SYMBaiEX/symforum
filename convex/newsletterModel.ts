
import { APEX_SITE_URL } from "../lib/site-urls";
import { v } from "convex/values";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const newsletterSubscriberStatusValidator = v.union(
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("unsubscribed"),
  v.literal("bounced"),
);

export const resendSyncStatusValidator = v.union(
  v.literal("idle"),
  v.literal("synced"),
  v.literal("failed"),
  v.literal("not_configured"),
);

export const newsletterIssueStatusValidator = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

export const newsletterIssueInputValidator = v.object({
  slug: v.optional(v.string()),
  subject: v.string(),
  previewText: v.string(),
  body: v.string(),
  status: v.optional(newsletterIssueStatusValidator),
  linkedPostSlug: v.optional(v.string()),
  scheduledAt: v.optional(v.number()),
});

export type NewsletterIssueInput = {
  slug?: string;
  subject: string;
  previewText: string;
  body: string;
  status?: "draft" | "scheduled" | "sent" | "cancelled" | "failed";
  linkedPostSlug?: string;
  scheduledAt?: number;
};

export function normalizeEmail(email: string) {
  const clean = email.trim().toLowerCase();
  if (
    clean.length < 5 ||
    clean.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)
  ) {
    throw new Error("Enter a valid email address");
  }
  return clean;
}

export function normalizeTokenHash(tokenHash: string) {
  const clean = tokenHash.trim().toLowerCase();
  if (!TOKEN_HASH_PATTERN.test(clean)) {
    throw new Error("Invalid newsletter token");
  }
  return clean;
}

export function trustedNewsletterSiteUrl(
  newsletterSiteUrl: string | undefined,
  siteUrl: string | undefined,
  callerSiteUrl?: string,
) {
  // Keep this compatibility argument explicit while ensuring a public caller
  // can never choose an email-link origin.
  void callerSiteUrl;
  const fallback = APEX_SITE_URL;
  for (const candidate of [newsletterSiteUrl, siteUrl]) {
    if (!candidate) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Try the next trusted environment value.
    }
  }
  return fallback;
}

export function normalizeNewsletterSource(source: string | undefined) {
  const clean = (source ?? "site").trim().toLowerCase();
  return clean.replace(/[^a-z0-9_-]/g, "-").slice(0, 40) || "site";
}

export function normalizeIssueInput(input: NewsletterIssueInput) {
  const subject = cleanRequired(input.subject, "Subject", 160);
  const previewText = cleanRequired(input.previewText, "Preview text", 240);
  const body = cleanRequired(input.body, "Body", 50000);
  const slug = normalizeSlug(input.slug || slugFromText(subject));
  const linkedPostSlug = input.linkedPostSlug
    ? normalizeSlug(input.linkedPostSlug)
    : undefined;

  return {
    slug,
    subject,
    previewText,
    body,
    status: input.status ?? "draft",
    linkedPostSlug,
    scheduledAt:
      typeof input.scheduledAt === "number" && Number.isFinite(input.scheduledAt)
        ? input.scheduledAt
        : undefined,
  };
}

function normalizeSlug(value: string) {
  const slug = slugFromText(value);
  if (!SLUG_PATTERN.test(slug) || slug.length > 96) {
    throw new Error("Invalid newsletter issue slug");
  }
  return slug;
}

function slugFromText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96);
}

function cleanRequired(value: string, label: string, maxLength: number) {
  const clean = value.trim();
  if (!clean) {
    throw new Error(`${label} is required`);
  }
  if (clean.length > maxLength) {
    throw new Error(`${label} is too long`);
  }
  return clean;
}
