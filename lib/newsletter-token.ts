import { createHash, randomBytes } from "node:crypto";

export function createNewsletterToken() {
  return `sym_nl_${randomBytes(32).toString("hex")}`;
}

export function newsletterTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newsletterSiteUrlFromRequest(requestUrl: string) {
  if (process.env.NEWSLETTER_SITE_URL) {
    return process.env.NEWSLETTER_SITE_URL;
  }
  try {
    return new URL(requestUrl).origin;
  } catch {
    return "https://symbaiex.com";
  }
}
