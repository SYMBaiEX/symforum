import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { SiteShell } from "@/components/site-shell";
import { isForumSubdomainHost } from "@/lib/forum-subdomain-routing";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { headers } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://symbaiex.com"),
  title: {
    default: "Austin Hamilton (SYMBiEX)",
    template: "%s | Austin Hamilton",
  },
  description:
    "A high-contrast personal blog for Austin Hamilton, software engineering, AI systems, and daily Hacker News notes.",
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
  const initialForumHost = isForumSubdomainHost(host);
  const initialPrimarySiteHref = primarySiteHrefFromForumHost({
    host,
    protocol: requestHeaders.get("x-forwarded-proto"),
  });
  const document = (
    /* `suppressHydrationWarning` only affects the html tag,
    // and is needed by `ThemeProvider` which sets the theme
    // class attribute on it */
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
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
    <ConvexAuthNextjsServerProvider>{document}</ConvexAuthNextjsServerProvider>
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
  const primaryHostname = hostname?.startsWith("forum.")
    ? hostname.slice("forum.".length)
    : "symbaiex.com";
  const primaryPort = port ? `:${port}` : "";
  const primaryProtocol =
    protocol ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${primaryProtocol}://${primaryHostname}${primaryPort}/`;
}
