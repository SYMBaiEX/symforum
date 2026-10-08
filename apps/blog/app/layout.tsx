import type { Metadata } from "next";
import Link from "next/link";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { blogSiteUrl } from "@/lib/site-urls";
import "./globals.css";

const description =
  "Essays and field notes by Austin Hamilton about software, AI systems, and engineering practice.";

export const metadata: Metadata = {
  metadataBase: new URL(blogSiteUrl("/")),
  title: {
    default: "SYMBaiEX Blog",
    template: "%s | SYMBaiEX Blog",
  },
  description,
  applicationName: "SYMBaiEX Blog",
  alternates: { canonical: blogSiteUrl("/blog") },
  openGraph: {
    type: "website",
    siteName: "SYMBaiEX Blog",
    url: blogSiteUrl("/blog"),
    title: "SYMBaiEX Blog",
    description,
    images: [
      {
        url: blogSiteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: "SYMBaiEX Blog — essays and field notes on software and AI.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMBaiEX Blog",
    description,
    images: [blogSiteUrl("/opengraph-image")],
    creator: "@symbiex",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

export default function BlogRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en" className="dark">
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX Blog"
          href="/feed/blog.xml"
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <AuthKitConvexProvider>
          <div className="relative z-10 flex min-h-screen flex-col">
            <header className="border-b border-row-border">
              <nav
                aria-label="Main navigation"
                className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 md:px-8"
              >
                <Link
                  href="/blog"
                  className="font-mono text-sm font-bold tracking-[0.12em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  SYMB<span className="text-primary">ai</span>EX
                  <span className="ml-3 hidden border-l border-row-border pl-3 text-[10px] font-normal uppercase tracking-[0.18em] text-muted-foreground sm:inline">
                    Field notes
                  </span>
                </Link>
                <Link
                  href="/feed/blog.xml"
                  className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  RSS feed
                </Link>
              </nav>
            </header>
            <main className="flex-1">{children}</main>
            <footer className="border-t border-row-border">
              <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground md:px-8">
                <span>Essays and field notes by Austin Hamilton</span>
                <Link
                  href="/feed/blog.xml"
                  className="underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Subscribe via RSS
                </Link>
              </div>
            </footer>
          </div>
        </AuthKitConvexProvider>
      </body>
    </html>
  );
  return <AuthServerBoundary>{document}</AuthServerBoundary>;
}
