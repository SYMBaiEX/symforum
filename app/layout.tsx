import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { SiteShell } from "@/components/site-shell";
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
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
            <SiteShell>{children}</SiteShell>
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
