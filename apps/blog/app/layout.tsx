import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { ForumSiteShell } from "@/components/forum/forum-site-shell";
import { blogSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX Blog"
          href="/feed/blog.xml"
        />
      </head>
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
              surface="blog"
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
