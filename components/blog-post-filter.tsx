"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";

const ALL_TAGS_VALUE = "__all";

export function BlogPostFilter({
  tags,
  selectedTag,
  totalPosts,
}: {
  tags: Array<{ count: number; name: string }>;
  selectedTag?: string;
  totalPosts: number;
}) {
  const router = useRouter();
  const selectedValue = selectedTag ?? ALL_TAGS_VALUE;

  function handleTagChange(value: string) {
    router.replace(
      value === ALL_TAGS_VALUE
        ? "/blog"
        : `/blog?tag=${encodeURIComponent(value)}`,
      { scroll: false },
    );
  }

  return (
    <div className="mb-6 flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
      <span id="blog-tag-filter-label">Tag</span>
      <Select onValueChange={handleTagChange} value={selectedValue}>
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
              All tags / {totalPosts}
            </SelectItem>
            {tags.map((tag) => (
              <SelectItem
                key={tag.name}
                className="font-mono text-[10px] uppercase"
                value={tag.name}
              >
                {tag.name} / {tag.count}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
