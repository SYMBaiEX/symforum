const STORAGE_RESTRICTED_NEWSLETTER_PATHS = new Set([
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
]);

export function isStorageRestrictedNewsletterPath(pathname: string | null) {
  return pathname !== null && STORAGE_RESTRICTED_NEWSLETTER_PATHS.has(pathname);
}
