"use client";

import { EntryRow } from "@/components/entry-row";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlogPost } from "@/lib/content";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

const ALL_TAGS_VALUE = "__all";

export function BlogPostFilter({ posts }: { posts: BlogPost[] }) {
  const router = useRouter();
  const tagParam = useSearchParams().get("tag");
  const tags = useMemo(
    () =>
      Array.from(new Set(posts.flatMap((post) => post.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [posts],
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts) {
      for (const tag of post.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return counts;
  }, [posts]);
  const selectedTag =
    tagParam && tags.includes(tagParam) ? tagParam : ALL_TAGS_VALUE;
  const visiblePosts = useMemo(() => {
    if (selectedTag === ALL_TAGS_VALUE) {
      return posts;
    }

    return posts.filter((post) => post.tags.includes(selectedTag));
  }, [posts, selectedTag]);

  function handleTagChange(value: string) {
    router.replace(
      value === ALL_TAGS_VALUE
        ? "/blog"
        : `/blog?tag=${encodeURIComponent(value)}`,
      { scroll: false },
    );
  }

  if (posts.length === 0) {
    return (
      <div className="py-6 font-mono text-xs uppercase text-muted-foreground">
        No published posts yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <span id="blog-tag-filter-label">Tag</span>
        <Select onValueChange={handleTagChange} value={selectedTag}>
          <SelectTrigger
            aria-labelledby="blog-tag-filter-label"
            className="h-7 w-[12rem] rounded-none border-row-border bg-background px-2 py-0 font-mono text-[10px] uppercase shadow-none"
          >
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent align="end" className="rounded-none">
            <SelectGroup>
              <SelectItem
                className="font-mono text-[10px] uppercase"
                value={ALL_TAGS_VALUE}
              >
                All tags / {posts.length}
              </SelectItem>
              {tags.map((tag) => (
                <SelectItem
                  key={tag}
                  className="font-mono text-[10px] uppercase"
                  value={tag}
                >
                  {tag} / {tagCounts.get(tag) ?? 0}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div>
        {visiblePosts.map((post, index) => (
          <EntryRow
            key={post.slug}
            post={post}
            divided={false}
            compact
            priority={index === 0}
            headingLevel="h2"
          />
        ))}
      </div>
      {/* 50 mirrors the .take(50) cap in convex/posts.ts listPublished */}
      {posts.length >= 50 && (
        <div className="mt-6 font-mono text-[10px] uppercase text-muted-foreground">
          Showing the latest 50 posts
        </div>
      )}
    </div>
  );
}
