import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const document = (
    /* `suppressHydrationWarning` only affects the html tag,
    // and is needed by `ThemeProvider` which sets the theme
    // class attribute on it */
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class">{children}</ThemeProvider>
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
