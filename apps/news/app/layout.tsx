import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { newsSiteUrl } from "@/lib/site-urls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(newsSiteUrl()),
  title: { default: "News", template: "%s | SYMBiEX News" },
  description: "A live index of Hacker News stories, sources, and discussion.",
  applicationName: "SYMBiEX News",
  alternates: { canonical: newsSiteUrl("/") },
  openGraph: {
    type: "website",
    siteName: "SYMBiEX News",
    title: "SYMBiEX News",
    description: "A live index of Hacker News stories, sources, and discussion.",
    url: newsSiteUrl("/"),
  },
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="alternate" type="application/rss+xml" title="SYMBiEX News" href="/feed/news.xml" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased news-app`}>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange enableSystem={false}>
          <AuthKitConvexProvider>
            <div className="news-site-frame">
              <header className="news-masthead">
                <Link className="news-wordmark focus-ring" href="/news" aria-label="SYMBiEX News home">
                  <span className="news-signal" aria-hidden="true" />
                  <span>SYMBiEX <span className="news-wordmark-muted">/ NEWS</span></span>
                </Link>
                <div className="news-live-label" aria-label="Live news desk">
                  <span className="news-live-dot" aria-hidden="true" />
                  <span>Live desk</span>
                </div>
                <a className="news-rss-link focus-ring" href="/feed/news.xml">RSS feed</a>
              </header>
              <main>{children}</main>
            </div>
          </AuthKitConvexProvider>
        </ThemeProvider>
      </body>
    </html>
  );
  return <AuthServerBoundary>{document}</AuthServerBoundary>;
}
