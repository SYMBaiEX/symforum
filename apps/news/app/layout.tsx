import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { ForumSiteShell } from "@/components/forum/forum-site-shell";
import { newsSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(newsSiteUrl()),
  title: { default: "News", template: "%s | SYMBiEX News" },
  description: "A live index of Hacker News stories, sources, and discussion.",
  applicationName: "SYMBiEX News",
  alternates: {
    canonical: newsSiteUrl("/"),
    types: { "application/rss+xml": "/feed/news.xml" },
  },
  openGraph: {
    type: "website",
    siteName: "SYMBiEX News",
    title: "SYMBiEX News",
    description:
      "A live index of Hacker News stories, sources, and discussion.",
    url: newsSiteUrl("/"),
  },
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          enableSystem={false}
        >
          <AuthKitConvexProvider>
            <ForumSiteShell
              forumHost={false}
              primarySiteHref={primarySiteUrl("/")}
              surface="news"
            >
              {children}
            </ForumSiteShell>
          </AuthKitConvexProvider>
        </ThemeProvider>
      </body>
    </html>
  );
  return <AuthServerBoundary>{document}</AuthServerBoundary>;
}
