import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://forum.symbaiex.com"),
};

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="forum-surface">{children}</div>;
}
