import { installation } from "./installation";
import { installationIdentityOrigins } from "./installation-config";
export const IDENTITY_BASE_PATH = "/api/identity";
export const IDENTITY_MARKER = "symbaiex-human-v1";
export const IDENTITY_ORIGINS = installationIdentityOrigins(installation);
export function safeIdentityReturnTo(value: string | null | undefined) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n\u0000-\u001f]/.test(value)
  )
    return "/";
  const url = new URL(value, "https://safe.invalid");
  return url.origin === "https://safe.invalid"
    ? url.pathname + url.search + url.hash
    : "/";
}
export function isRecoveryEmail(email: string) {
  const normalized = email.toLowerCase();
  return (
    email.length <= 254 &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) &&
    !normalized.endsWith(".invalid") &&
    !normalized.endsWith(".local")
  );
}
export function isFreshIdentitySession(
  createdAt: Date | string | number,
  now = Date.now(),
) {
  const timestamp = new Date(createdAt).getTime();
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age <= 300_000;
}
