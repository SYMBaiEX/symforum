const CONTENT_SUBDOMAIN_ROOTS: Record<string, string> = {
  "blog.symbaiex.com": "/blog",
  "news.symbaiex.com": "/news",
  "newsletter.symbaiex.com": "/newsletter",
};

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
