import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { ForumSiteShell } from "@/components/forum/forum-site-shell";
import { NEWSLETTER_SITE_URL, primarySiteUrl } from "@/lib/site-urls";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(NEWSLETTER_SITE_URL),
  title: {
    default: "SYMBaiEX Newsletter",
    template: "%s | SYMBaiEX Newsletter",
  },
  description: "Belle's source-grounded daily signals and weekly field notes.",
  applicationName: "SYMBaiEX Newsletter",
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/feed/newsletter.xml" },
  },
  openGraph: {
    siteName: "SYMBaiEX Newsletter",
    title: "SYMBaiEX Newsletter",
    description:
      "Belle's source-grounded daily signals and weekly field notes.",
    type: "website",
    url: NEWSLETTER_SITE_URL,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMBaiEX Newsletter",
    description:
      "Belle's source-grounded daily signals and weekly field notes.",
    images: ["/opengraph-image"],
    creator: "@symbiex",
  },
};

export default function NewsletterRootLayout({
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
              surface="newsletter"
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
