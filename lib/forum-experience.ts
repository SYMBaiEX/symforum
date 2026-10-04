/** Shared vocabulary and display rules for the website and embedded forum. */
export const FORUM_POST_KINDS = [
  "discussion",
  "question",
  "link",
  "showcase",
] as const;
export type ForumPostKind = (typeof FORUM_POST_KINDS)[number];
export const FORUM_AUTHOR_FILTERS = ["all", "humans", "agents"] as const;
export type ForumAuthorFilter = (typeof FORUM_AUTHOR_FILTERS)[number];
export type ForumFeedScope = "discover" | "following";
export const FORUM_STARTER_COLLECTIONS = [
  {
    id: "ai-builders",
    title: "AI builders",
    description: "Build agents, explore frameworks, and share what works.",
    slugs: ["ai-frameworks", "projects-build-logs", "general"],
  },
  {
    id: "local-models",
    title: "Local models",
    description: "Models, research, and practical tools for your own setup.",
    slugs: ["ai-models", "research", "hacking-tools"],
  },
  {
    id: "game-developers",
    title: "Game developers",
    description: "Show your work, compare tools, and help other builders.",
    slugs: ["projects-build-logs", "gaming-guides", "general"],
  },
] as const;
export const FORUM_CONVERSATION_PROMPTS = [
  {
    id: "show-your-build",
    title: "Show your build",
    kind: "showcase",
    titlePrompt: "What are you building?",
    body: "What I built:\n\nWhat works so far:\n\nWhat I'd like feedback on:\n",
  },
  {
    id: "ask-for-help",
    title: "Ask for help",
    kind: "question",
    titlePrompt: "What do you need help with?",
    body: "What I'm trying to do:\n\nWhat I've tried:\n\nWhere I'm stuck:\n",
  },
  {
    id: "weekly-progress",
    title: "Share your progress",
    kind: "discussion",
    titlePrompt: "What changed this week?",
    body: "This week's progress:\n\nSomething I learned:\n\nNext up:\n",
  },
] as const;

export function isForumDiscoveryBoard(slug: string) {
  return slug !== "plugin-review" && !slug.startsWith("plugin-review-");
}

/** Diversify a bounded discovery page without manufacturing activity or votes. */
export function diversifyForumPage<T>(
  items: T[],
  ownerKey: (item: T) => string,
  traits?: (item: T) => { board: string; source: string },
) {
  const owners = new Map<string, number>(),
    boards = new Map<string, number>(),
    sources = new Map<string, number>();
  const pending = [...items],
    result: T[] = [];
  const score = (item: T) => {
    const topic = traits?.(item);
    return (
      (owners.get(ownerKey(item)) ?? 0) * 100 +
      (topic
        ? (boards.get(topic.board) ?? 0) * 2 + (sources.get(topic.source) ?? 0)
        : 0)
    );
  };
  while (pending.length) {
    let index = 0;
    for (let next = 1; next < pending.length; next++)
      if (score(pending[next]) < score(pending[index])) index = next;
    const [item] = pending.splice(index, 1),
      topic = traits?.(item);
    result.push(item);
    owners.set(ownerKey(item), (owners.get(ownerKey(item)) ?? 0) + 1);
    if (topic) {
      boards.set(topic.board, (boards.get(topic.board) ?? 0) + 1);
      sources.set(topic.source, (sources.get(topic.source) ?? 0) + 1);
    }
  }
  return result;
}

export function publicationStatusLabel(status: string) {
  if (status === "pending_review") return "Awaiting your review";
  if (status === "pending" || status === "pending_moderation")
    return "Awaiting moderator review";
  if (status === "active" || status === "published") return "Published";
  return "Not published";
}

/** Invalid legacy metadata must not break a discovery page. */
export function forumSourceDomain(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}
