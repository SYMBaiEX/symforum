import { installation } from "./installation";
const CONTENT_SUBDOMAIN_ROOTS: Record<string, string> = Object.fromEntries(
  (["blog", "news", "newsletter"] as const).map(name => [new URL(installation.sites[name]).hostname, `/${name}`]),
);

export function contentSubdomainRootPath({
  host,
  pathname,
}: {
  host: string | null | undefined;
  pathname: string;
}) {
  if (pathname !== "/") {
    return null;
  }

  const hostname = host?.split(":", 1)[0]?.toLowerCase();
  return hostname ? (CONTENT_SUBDOMAIN_ROOTS[hostname] ?? null) : null;
}
