import "server-only";

import { invalidateServerCache } from "@/lib/server-cache";
import { revalidatePath } from "next/cache";

export async function invalidateBlogCache(slug: string) {
  await invalidateServerCache(
    "posts:published",
    "posts:featured",
    `posts:slug:${slug}`,
  );
  revalidatePath("/");
  revalidatePath("/blog");
  revalidatePath(`/blog/${encodeURIComponent(slug)}`);
}
