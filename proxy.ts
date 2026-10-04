import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import {
  isPrivateAiReadablePath,
  normalizePathname,
} from "@/lib/ai-readable-path";
import { DISCOVERY_LINK_HEADER } from "@/lib/agent-discovery";
import { resolveForumSubdomainRoute } from "@/lib/forum-subdomain-routing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const FORUM_PRODUCTION_HOSTNAME = "forum.symbaiex.com";
const PRIMARY_PRODUCTION_HOSTNAME = "www.symbaiex.com";
const MARKDOWN_404_SIGNAL_HEADER = "x-symbaiex-markdown-404";
const SONNER_STYLE_HASHES = [
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
  "'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY='",
  "'sha256-441zG27rExd4/il+NvIqyL8zFx5XmyNQtE381kSkUJk='",
  "'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='",
  "'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='",
];
const proxy = convexConfigured
  ? convexAuthNextjsMiddleware(
      async (request, { convexAuth }) => {
        const policy = contentSecurityPolicy();
        if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
          const redirectTo = cleanRedirect(
            request.nextUrl.searchParams.get("redirectTo"),
          );
          return applySecurityHeaders(
            nextjsMiddlewareRedirect(request, redirectTo),
            policy,
            request,
          );
        }
        return applySecurityHeaders(
          nextOrForumRewrite(request, policy),
          policy,
          request,
        );
      },
      {
        convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
        cookieConfig: { maxAge: AUTH_COOKIE_MAX_AGE_SECONDS },
      },
    )
  : function proxy(request: NextRequest) {
      const policy = contentSecurityPolicy();
      return applySecurityHeaders(
        nextOrForumRewrite(request, policy),
        policy,
        request,
      );
    };

export default proxy;

export const config = {
  // The following matcher runs Proxy on all routes
  // except static assets.
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/(.*)\\.md",
    "/",
    "/(api|trpc)(.*)",
    "/llms.txt",
    "/llms-full.txt",
    "/feed/:path*",
  ],
};

function cleanRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function nextWithNonce(request: NextRequest, policy: SecurityPolicy) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(MARKDOWN_404_SIGNAL_HEADER);
  if (acceptsMediaType(request.headers.get("accept"), "text/markdown")) {
    requestHeaders.set(MARKDOWN_404_SIGNAL_HEADER, "1");
  }
  const response = NextResponse.next({
    request: {
      headers: nonceRequestHeaders(
        requestHeaders,
        policy,
        request.nextUrl.pathname,
      ),
    },
  });
  response.headers.set("Vary", "Accept, Host, User-Agent");
  return response;
}

function nextOrForumRewrite(request: NextRequest, policy: SecurityPolicy) {
  const markdownResponse = markdownRewrite(request, policy);
  if (markdownResponse !== null) {
    return markdownResponse;
  }

  const forumRoute = forumSubdomainRoute(request);
  if (forumRoute === null) {
    return nextWithNonce(request, policy);
  }
  if (forumRoute.kind === "redirect") {
    return applySecurityHeaders(
      forumRoute.absolute
        ? absoluteRedirect(forumRoute.url)
        : NextResponse.redirect(forumRoute.url, 308),
      policy,
      request,
    );
  }

  return NextResponse.rewrite(forumRoute.url, {
    request: {
      headers: nonceRequestHeaders(
        new Headers(request.headers),
        policy,
        request.nextUrl.pathname,
      ),
    },
  });
}

function markdownRewrite(request: NextRequest, policy: SecurityPolicy) {
  const markdownRequest = getMarkdownRequest(request);
  if (markdownRequest === null) {
    return null;
  }

  const sourcePath = normalizePathname(markdownRequest.sourcePath);
  if (isPrivateAiReadablePath(sourcePath)) {
    return applySecurityHeaders(
      new NextResponse("Not found\n", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
      policy,
      request,
    );
  }

  const forumRoute = resolveForumSubdomainRoute({
    host: request.headers.get("host"),
    pathname: sourcePath,
  });
  if (forumRoute?.kind === "redirect") {
    const destination = request.nextUrl.clone();
    destination.pathname = `${forumRoute.pathname === "/" ? "" : forumRoute.pathname}.md`;
    if (forumRoute.primaryHost) {
      const primaryHost = primaryHostForForumHost(request.headers.get("host"));
      if (primaryHost !== null) {
        applyHost(destination, primaryHost);
      }
    }
    return applySecurityHeaders(
      NextResponse.redirect(destination, 308),
      policy,
      request,
    );
  }

  const internalPath =
    forumRoute?.kind === "rewrite" ? forumRoute.pathname : sourcePath;
  const url = request.nextUrl.clone();
  url.pathname = `/markdown${internalPath === "/" ? "" : internalPath}`;
  const headers = nonceRequestHeaders(
    new Headers(request.headers),
    policy,
    sourcePath,
  );
  headers.set("x-symbaiex-markdown-source", sourcePath);
  logAiReadableRequest(request, sourcePath, markdownRequest.format);
  return applySecurityHeaders(
    NextResponse.rewrite(url, { request: { headers } }),
    policy,
    request,
  );
}

function getMarkdownRequest(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/llms.txt" ||
    pathname === "/llms-full.txt" ||
    pathname === "/agents.md" ||
    pathname === "/auth.md" ||
    pathname === "/pricing.md"
  ) {
    return null;
  }

  const explicitAlias = /\.md$/i.test(pathname);
  const supportedPage = hasAiReadableRepresentation(pathname);
  const agentMode =
    supportedPage && request.nextUrl.searchParams.get("mode") === "agent";
  const agentUserAgent =
    supportedPage && isAgentUserAgent(request.headers.get("user-agent"));
  const acceptsMarkdown = acceptsMediaType(
    request.headers.get("accept"),
    "text/markdown",
  );
  if (
    !explicitAlias &&
    acceptsMarkdown &&
    !supportedPage &&
    !isPrivateAiReadablePath(pathname)
  ) {
    return null;
  }
  if (!explicitAlias && !acceptsMarkdown && !agentMode && !agentUserAgent) {
    return null;
  }

  const sourcePath = explicitAlias
    ? pathname.replace(/\.md$/i, "") || "/"
    : pathname;
  return {
    sourcePath,
    format: explicitAlias
      ? "markdown-alias"
      : agentMode
        ? "agent-mode"
        : agentUserAgent
          ? "agent-user-agent"
          : "content-negotiated-markdown",
  } as const;
}

function isAgentUserAgent(value: string | null) {
  return /(?:GPTBot|ClaudeBot|ChatGPT-User|PerplexityBot|Google-Extended|Applebot-Extended|ora-agent|DeepSeekBot)/i.test(
    value ?? "",
  );
}

function acceptsMediaType(value: string | null, mediaType: string) {
  if (!value) return false;
  return value.split(",").some((part) => {
    const [type, ...parameters] = part.trim().toLowerCase().split(";");
    if (type !== mediaType && type !== "text/*") {
      return false;
    }
    const quality = parameters.find((parameter) =>
      parameter.trim().startsWith("q="),
    );
    return quality === undefined || Number(quality.split("=")[1]) > 0;
  });
}

function logAiReadableRequest(
  request: NextRequest,
  pathname: string,
  format:
    | "markdown-alias"
    | "agent-mode"
    | "agent-user-agent"
    | "content-negotiated-markdown",
) {
  const userAgent = request.headers
    .get("user-agent")
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 180);
  const accept = request.headers
    .get("accept")
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 180);
  const referer = request.headers
    .get("referer")
    ?.replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 240);
  console.info("[ai-readable] request", {
    host: request.headers.get("host"),
    method: request.method,
    pathname,
    format,
    accept: accept || undefined,
    referer: referer || undefined,
    userAgent: userAgent || undefined,
  });
}

function forumSubdomainRoute(request: NextRequest) {
  const route = resolveForumSubdomainRoute({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
  });
  if (route === null) {
    return null;
  }

  if (route.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = route.pathname;
    if (route.primaryHost) {
      const primaryHost = primaryHostForForumHost(request.headers.get("host"));
      if (primaryHost !== null) {
        applyHost(url, primaryHost);
      }
    }
    return {
      kind: "redirect" as const,
      url,
      absolute: route.primaryHost === true,
    };
  }

  const url = request.nextUrl.clone();
  url.pathname = route.pathname;
  return { kind: "rewrite" as const, url };
}

function primaryHostForForumHost(host: string | null) {
  if (host === null) {
    return null;
  }
  const [hostname, port] = host.split(":");
  const normalizedHostname = hostname.toLowerCase();
  if (!normalizedHostname.startsWith("forum.")) {
    return null;
  }
  if (normalizedHostname === FORUM_PRODUCTION_HOSTNAME) {
    return PRIMARY_PRODUCTION_HOSTNAME;
  }
  if (normalizedHostname === "forum.localhost") {
    return `symbaiex.localhost${port ? `:${port}` : ""}`;
  }
  const primaryHostname = hostname.slice("forum.".length);
  return `${primaryHostname}${port ? `:${port}` : ""}`;
}

function applyHost(url: { hostname: string; port: string }, host: string) {
  const [hostname, port = ""] = host.split(":");
  url.hostname = hostname;
  url.port = port;
}

function absoluteRedirect(url: URL) {
  return new NextResponse(null, {
    status: 308,
    headers: {
      Location: url.toString(),
    },
  });
}

function nonceRequestHeaders(
  headers: Headers,
  policy: SecurityPolicy,
  pathname: string,
) {
  headers.set("x-nonce", policy.nonce);
  headers.set("x-symbaiex-pathname", pathname);
  headers.set("Content-Security-Policy", policy.value);
  return headers;
}

type SecurityPolicy = {
  nonce: string;
  value: string;
};

function contentSecurityPolicy(): SecurityPolicy {
  const nonce = randomNonce();
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `script-src-elem 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    isDev
      ? "style-src-elem 'self' 'unsafe-inline'"
      : `style-src-elem 'self' 'nonce-${nonce}' ${SONNER_STYLE_HASHES.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' https://symbaiex.com https://${PRIMARY_PRODUCTION_HOSTNAME} https://*.convex.cloud wss://*.convex.cloud https://*.convex.site${isDev ? " http://localhost:* ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

  return { nonce, value: policy };
}

function applySecurityHeaders(
  response: NextResponse,
  policy: SecurityPolicy,
  request?: NextRequest,
) {
  response.headers.set("Content-Security-Policy", policy.value);
  const isOAuthConnect =
    request?.nextUrl.pathname === "/agent/connect" ||
    request?.nextUrl.pathname === "/agent/claim" ||
    request?.nextUrl.pathname.startsWith("/agent-auth/") ||
    (request?.nextUrl.pathname === "/signin" &&
      request.nextUrl.searchParams
        .get("redirectTo")
        ?.startsWith("/agent/claim"));
  response.headers.set(
    "Referrer-Policy",
    isOAuthConnect ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  if (isOAuthConnect) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  const webMcpTrialToken = webMcpOriginTrialToken(request);
  if (webMcpTrialToken) {
    response.headers.set("Origin-Trial", webMcpTrialToken);
  }
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set(
    "Vary",
    mergeVary(response.headers.get("Vary"), "Accept, Host, User-Agent"),
  );
  response.headers.set(
    "Link",
    mergeLink(response.headers.get("Link"), DISCOVERY_LINK_HEADER),
  );
  const alternate = request ? markdownAlternateLink(request) : null;
  if (alternate) {
    response.headers.set(
      "Link",
      mergeLink(response.headers.get("Link"), alternate),
    );
  }
  return response;
}

function webMcpOriginTrialToken(request?: NextRequest) {
  const token = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN?.trim();
  if (
    !request ||
    !token ||
    token.length > 4096 ||
    /[^\x21-\x7e]/.test(token) ||
    request.method !== "GET" ||
    request.nextUrl.hostname !== PRIMARY_PRODUCTION_HOSTNAME ||
    !acceptsMediaType(request.headers.get("accept"), "text/html") ||
    getMarkdownRequest(request) !== null ||
    !["/", "/agent", "/developers", "/forum"].some(
      (path) =>
        request.nextUrl.pathname === path ||
        (path === "/forum" && request.nextUrl.pathname.startsWith("/forum/")),
    )
  ) {
    return null;
  }
  return token;
}

function markdownAlternateLink(request: NextRequest) {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    getMarkdownRequest(request) !== null ||
    !hasAiReadableRepresentation(request.nextUrl.pathname)
  ) {
    return null;
  }
  const url = request.nextUrl.clone();
  const pathname = normalizePathname(url.pathname);
  url.pathname = pathname === "/" ? "/index.md" : `${pathname}.md`;
  url.search = "";
  return `<${url.toString()}>; rel="alternate"; type="text/markdown"`;
}

function hasAiReadableRepresentation(pathname: string) {
  const normalized = normalizePathname(pathname);
  if (isPrivateAiReadablePath(normalized)) return false;
  if (
    new Set([
      "/",
      "/index",
      "/about",
      "/contact",
      "/developers",
      "/privacy",
      "/ai-policy",
      "/agent/instructions",
      "/research",
      "/research/ai-readable-web",
      "/research/editorial-trust-and-contracts",
      "/research/methodology",
      "/blog",
      "/news",
      "/portfolio",
      "/newsletter",
      "/forum",
      "/forum/agents",
      "/forum/announcements",
      "/forum/help",
      "/forum/calendar",
      "/forum/members",
      "/forum/online",
      "/forum/new-posts",
      "/forum/todays-posts",
    ]).has(normalized)
  ) {
    return true;
  }
  return [
    "/blog/",
    "/news/",
    "/portfolio/",
    "/newsletter/",
    "/forum/announcements/",
    "/forum/help/",
    "/forum/calendar/",
    "/forum/members/",
    "/forum/",
    "/u/",
  ].some((prefix) => normalized.startsWith(prefix));
}

function mergeVary(current: string | null, additional: string) {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const value of additional.split(",")) {
    values.add(value.trim());
  }
  return [...values].join(", ");
}

function mergeLink(current: string | null, additional: string) {
  if (!current) return additional;
  return current.includes(additional) ? current : `${current}, ${additional}`;
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
