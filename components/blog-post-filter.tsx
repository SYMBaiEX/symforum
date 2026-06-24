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
import { useMemo, useState } from "react";

const ALL_TAGS_VALUE = "__all";

export function BlogPostFilter({ posts }: { posts: BlogPost[] }) {
  const [selectedTag, setSelectedTag] = useState(ALL_TAGS_VALUE);
  const tags = useMemo(
    () =>
      Array.from(new Set(posts.flatMap((post) => post.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [posts],
  );
  const visiblePosts = useMemo(() => {
    if (selectedTag === ALL_TAGS_VALUE) {
      return posts;
    }

    return posts.filter((post) => post.tags.includes(selectedTag));
  }, [posts, selectedTag]);

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
        <Select onValueChange={setSelectedTag} value={selectedTag}>
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
              {tags.map((tag) => {
                const count = posts.filter((post) =>
                  post.tags.includes(tag),
                ).length;

                return (
                  <SelectItem
                    key={tag}
                    className="font-mono text-[10px] uppercase"
                    value={tag}
                  >
                    {tag} / {count}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div>
        {visiblePosts.map((post) => (
          <EntryRow key={post.slug} post={post} divided={false} compact />
        ))}
      </div>
    </div>
  );
}
