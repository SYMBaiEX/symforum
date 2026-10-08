import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { FORUM_PLUGIN_RESOURCE } from "@symbaiex/forum-plugin-contract";
import { ForumWebMcp, SiteShell } from "@symbaiex/forum-ui";
import { FORUM_SHARED_THEME_CSS } from "@symbaiex/forum-ui/theme";
import { FORUM_SITE_URL } from "@/lib/site-urls";
import "katex/dist/katex.min.css";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(FORUM_SITE_URL),
  title: { default: "SYMBaiEX forum", template: "%s | SYMBaiEX forum" },
  description:
    "A public discussion board for software, AI systems, open source, and adjacent experiments.",
  applicationName: "SYMBaiEX Forum",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: "SYMBaiEX forum",
    title: "SYMBaiEX forum",
    description:
      "A public discussion board for software, AI systems, open source, and adjacent experiments.",
    type: "website",
    url: FORUM_SITE_URL,
    images: [{ url: "https://www.symbaiex.com/opengraph-image", width: 1200, height: 630 }],
  },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function ForumRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="forum-plugin-resource" content={FORUM_PLUGIN_RESOURCE} />
        <style>{FORUM_SHARED_THEME_CSS}</style>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <AuthKitConvexProvider>
            <SiteShell initialForumHost initialPrimarySiteHref="https://www.symbaiex.com/">
              <div className="forum-surface relative z-10 min-h-dvh">
                <ForumWebMcp />
                {children}
              </div>
            </SiteShell>
          </AuthKitConvexProvider>
        </ThemeProvider>
      </body>
    </html>
  );
  return <AuthServerBoundary>{document}</AuthServerBoundary>;
}
