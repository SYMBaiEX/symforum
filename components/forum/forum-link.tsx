"use client";

import { forumHrefForPathname } from "@/components/forum/forum-refs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";

export const ForumLink = forwardRef<
  HTMLAnchorElement,
  Omit<ComponentProps<typeof Link>, "href"> & { href: string }
>(function ForumLink({ href, prefetch, ...props }, ref) {
  const pathname = usePathname();
  return (
    <Link
      {...props}
      href={forumHrefForPathname(href, pathname)}
      prefetch={prefetch}
      ref={ref}
    />
  );
});
