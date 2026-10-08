import type { Metadata } from "next";
import { AuthKitConvexProvider } from "@symbaiex/auth/client";
import { AuthServerBoundary } from "@symbaiex/auth/server";
import { NEWSLETTER_SITE_URL } from "@/lib/site-urls";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(NEWSLETTER_SITE_URL),
  title: {
    default: "SYMBaiEX Newsletter",
    template: "%s | SYMBaiEX Newsletter",
  },
  description: "Belle's source-grounded daily signals and weekly field notes.",
  applicationName: "SYMBaiEX Newsletter",
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "SYMBaiEX Newsletter",
    title: "SYMBaiEX Newsletter",
    description: "Belle's source-grounded daily signals and weekly field notes.",
    type: "website",
    url: NEWSLETTER_SITE_URL,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SYMBaiEX Newsletter",
    description: "Belle's source-grounded daily signals and weekly field notes.",
    images: ["/opengraph-image"],
    creator: "@symbiex",
  },
};

export default function NewsletterRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en" className="dark">
      <head>
        <link
          rel="alternate"
          type="application/rss+xml"
          title="SYMBaiEX Newsletter"
          href="/feed/newsletter.xml"
        />
      </head>
      <body>
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-sm focus:uppercase focus-ring"
          href="#main-content"
        >
          Skip to content
        </a>
        <AuthKitConvexProvider>
          <main id="main-content" tabIndex={-1} className="relative z-10 outline-none">
            {children}
          </main>
        </AuthKitConvexProvider>
      </body>
    </html>
  );
  return <AuthServerBoundary>{document}</AuthServerBoundary>;
}
