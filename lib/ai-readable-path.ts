const PRIVATE_PREFIXES = [
  "/admin",
  "/profile",
  "/signin",
  "/agent/signup",
  "/agent/connect",
  "/agent/claim",
  "/agent-auth",
  "/newsletter/confirm",
  "/newsletter/preferences",
  "/newsletter/unsubscribe",
  "/forum/control-panel",
  "/forum/messages",
  "/forum/moderation",
  "/forum/saved",
  "/forum/subscriptions",
  "/forum/search",
];

export function isPrivateAiReadablePath(pathname: string) {
  const normalized = normalizePathname(pathname);
  return PRIVATE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export function normalizePathname(pathname: string) {
  const withoutQuery =
    (pathname.split("?", 1)[0] ?? "/").replace(/\/+$/, "") || "/";
  const decoded = withoutQuery.replace(/\.md$/i, "").replace(/\/+/g, "/");
  const normalized = decoded.startsWith("/") ? decoded : `/${decoded}`;
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : "/";
}
