import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { NoScriptFallback } from "@/components/no-script-fallback";
import { SiteShell } from "@/components/site-shell";
import { renderAiReadablePage } from "@/lib/ai-readable";
import { isForumSubdomainHost } from "@/lib/forum-subdomain-routing";
import { isStorageRestrictedNewsletterPath } from "@/lib/newsletter-route-paths";
import { FORUM_SITE_URL, PRIMARY_SITE_URL } from "@/lib/site-urls";
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  SITE_NAME,
  siteStructuredData,
  serializeJsonLd,
} from "@/lib/seo";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { headers } from "next/headers";

const FORUM_PRODUCTION_HOSTNAME = new URL(FORUM_SITE_URL).hostname;
const PRIMARY_PRODUCTION_HOSTNAME = new URL(PRIMARY_SITE_URL).hostname;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A high-contrast personal blog for Austin Hamilton, software engineering, AI systems, and daily Hacker News notes.";

export const metadata: Metadata = {
  metadataBase: new URL(PRIMARY_SITE_URL),
  title: {
    default: SITE_NAME,
    template: "%s | Austin Hamilton",
  },
  description,
  applicationName: "SYMBaiEX",
  authors: [{ name: AUTHOR_NAME, url: AUTHOR_URL }],
  creator: AUTHOR_NAME,
  publisher: AUTHOR_NAME,
  verification: {
    google: "AVfFR1DDUluyBZUxPYC4UoxmzZK5E9tjV6zPHtxJs7k",
    other: {
      "msvalidate.01": "BB917F8600A2D07414E607FEA895A6B0",
    },
  },
  keywords: [
    "Austin Hamilton",
    "SYMBaiEX",
    "software engineering",
    "AI systems",
    "AI agents",
    "open source",
    "research notes",
  ],
  category: "technology",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    siteName: "Austin Hamilton (SYMBiEX)",
    title: "Austin Hamilton (SYMBiEX)",
    description,
    type: "website",
    url: PRIMARY_SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Austin Hamilton (SYMBiEX)",
    description,
    creator: "@symbiex",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const host = requestHeaders.get("host");
  const useInMemoryAuthStorage = isStorageRestrictedNewsletterPath(
    requestHeaders.get("x-symbaiex-pathname"),
  );
  const initialForumHost = isForumSubdomainHost(host);
  const initialPrimarySiteHref = primarySiteHrefFromForumHost({
    host,
    protocol: requestHeaders.get("x-forwarded-proto"),
  });
  const requestPath = requestHeaders.get("x-symbaiex-pathname") ?? "/";
  const isForumSurface =
    initialForumHost ||
    requestPath === "/forum" ||
    requestPath.startsWith("/forum/");
  // Render one no-JS representation at the root boundary. Keeping the Forum
  // fallback here (rather than in its nested async layout) avoids multiple
  // React streaming insertion points and preserves readable forum content
  // without a second Convex-backed render.
  const fallbackPath =
    initialForumHost && requestPath === "/"
      ? "/forum"
      : initialForumHost && requestPath.startsWith("/")
        ? `/forum${requestPath}`
        : requestPath;
  const noScriptFallback =
    requestPath === "/" && !isForumSurface
      ? null
      : await renderAiReadablePage({ pathname: fallbackPath, host });
  const document = (
    /* `suppressHydrationWarning` only affects the html tag,
    // and is needed by `ThemeProvider` which sets the theme
    // class attribute on it */
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX Blog"
          href="/feed/blog.xml"
        />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX News"
          href="/feed/news.xml"
        />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX Newsletter"
          href="/feed/newsletter.xml"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <script
          id="site-structured-data"
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(siteStructuredData()),
          }}
        />
        {noScriptFallback ? (
          <NoScriptFallback content={noScriptFallback.markdown} />
        ) : null}
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          enableSystem={false}
          nonce={nonce}
        >
          <ConvexClientProvider>
            <SiteShell
              initialForumHost={initialForumHost}
              initialPrimarySiteHref={initialPrimarySiteHref}
            >
              {children}
            </SiteShell>
          </ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return document;
  }

  return (
    <ConvexAuthNextjsServerProvider
      storage={useInMemoryAuthStorage ? "inMemory" : "localStorage"}
    >
      {document}
    </ConvexAuthNextjsServerProvider>
  );
}

function primarySiteHrefFromForumHost({
  host,
  protocol,
}: {
  host: string | null;
  protocol: string | null;
}) {
  if (!isForumSubdomainHost(host)) {
    return "/";
  }
  const [hostname, port] = (host ?? "").split(":");
  const primaryHostname =
    hostname === FORUM_PRODUCTION_HOSTNAME
      ? PRIMARY_PRODUCTION_HOSTNAME
      : hostname?.startsWith("forum.")
        ? hostname.slice("forum.".length)
        : PRIMARY_PRODUCTION_HOSTNAME;
  const primaryPort =
    hostname === FORUM_PRODUCTION_HOSTNAME || !port ? "" : `:${port}`;
  const primaryProtocol =
    protocol ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${primaryProtocol}://${primaryHostname}${primaryPort}/`;
}
