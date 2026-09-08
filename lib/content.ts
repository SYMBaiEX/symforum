export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  readingMinutes: number;
  tags: string[];
  featured?: boolean;
  imageUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
  body: string;
};

/** Metadata needed by blog listing surfaces; article bodies stay detail-only. */
export type BlogPostSummary = Omit<BlogPost, "body">;

export const blogPosts: BlogPost[] = [
  {
    slug: "grid-systems-for-agentic-interfaces",
    title: "Grid systems for agentic interfaces",
    excerpt:
      "A short note on making AI products feel precise, authored, and less like a pile of floating panels.",
    publishedAt: "2026-06-20",
    readingMinutes: 4,
    tags: ["design", "ai", "systems"],
    featured: true,
    body: `## The promise of structure

The grid is not decoration. It is a promise that a product has made choices before asking the user to make theirs.

For agentic interfaces, that matters. Tool output, memory, source trails, and user intent all compete for attention. A disciplined grid turns that competition into hierarchy.

> The user should be able to scan, compare, and decide without feeling the machinery thrash behind the curtain.

That hierarchy can be described as a simple ratio:

$$
\\text{clarity} = \\frac{\\text{signal}}{\\text{choices exposed too early}}
$$

In practice, I keep the surface tight:

- one dominant reading column
- small metadata lanes
- interaction controls that stay close to the object they affect

| Layer | Job |
| --- | --- |
| Content | Carry the argument |
| Metadata | Add context without stealing focus |
| Actions | Stay available, not loud |

The best grid disappears after it teaches the page where to breathe.`,
  },
  {
    slug: "why-terminal-aesthetics-still-work",
    title: "Why terminal aesthetics still work",
    excerpt:
      "Text-mode interfaces keep showing up because they compress status, mood, and control into one honest surface.",
    publishedAt: "2026-06-08",
    readingMinutes: 3,
    tags: ["frontend", "ascii", "craft"],
    body: `ASCII art works when it behaves like an instrument panel, not wallpaper.

A terminal surface is high trust because it exposes structure. It can be playful, but it should still feel like it belongs to the system.

\`\`\`txt
SYMBiEX :: signal through constraint
mode    :: readable first, animated second
surface :: sharp enough to trust
\`\`\`

For this site, the ASCII layer is a signature mark: present, moving, and then quiet enough for the writing to take over.`,
  },
  {
    slug: "personal-sites-as-operating-systems",
    title: "Personal sites as operating systems",
    excerpt:
      "A personal blog can be more than an archive. It can be a small control room for taste, links, research, and public memory.",
    publishedAt: "2026-05-24",
    readingMinutes: 5,
    tags: ["personal", "web", "ops"],
    body: `The best personal sites feel alive without becoming social feeds.

They are quiet systems: curated, indexed, and unmistakably owned. A homepage can hold identity, recent work, public notes, and a few weird artifacts that make it human.

A blog is not just a place to publish. It is a place to keep promises with yourself in public.[^promise]

[^promise]: The promise is mostly to keep showing up with enough clarity that future-you can understand what present-you meant.`,
  },
];

export function getPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug) ?? null;
}
