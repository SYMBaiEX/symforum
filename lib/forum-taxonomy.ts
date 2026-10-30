/** Slugs remain stable so historical forum links and receipts do not change. */
export const FORUM_FOCUS_PILLARS = [
  "ai",
  "gaming",
  "crypto",
  "hacking",
  "music",
] as const;
export type ForumFocusPillar = (typeof FORUM_FOCUS_PILLARS)[number];
export const FORUM_ARCHIVE_ROOTS = [
  "projects",
  "research",
  "forum-news",
] as const;
export const FORUM_TAXONOMY_VERSION = "five-pillars-v1";

type CategoryNode = {
  _id: string;
  parentCategoryId?: string;
  readOnlyArchive?: boolean;
};

/** Missing/cyclic/deeper-than-supported ancestry fails closed for writes. */
export function categoryIsReadOnlyInGraph(
  category: CategoryNode,
  categories: ReadonlyMap<string, CategoryNode>,
): boolean {
  let node: CategoryNode | undefined = category;
  const visited = new Set<string>();
  for (let depth = 0; depth <= 10 && node !== undefined; depth += 1) {
    if (node.readOnlyArchive === true || visited.has(node._id)) return true;
    visited.add(node._id);
    if (node.parentCategoryId === undefined) return false;
    node = categories.get(node.parentCategoryId);
  }
  return true;
}

/** Conservative source classification; unmatched general news is not forced in. */
export function forumFocusPillarForText(text: string): ForumFocusPillar | null {
  if (
    /\b(?:solana|blockchain|web3|onchain|on-chain|ethereum|bitcoin|stablecoin|defi)\b|pump[.\s-]?fun|bags\.fm/i.test(
      text,
    )
  )
    return "crypto";
  if (
    /\b(?:vulnerabilit\w*|cybersecurity|security advisory|malware|ransomware|CVE-\d|exploit|reverse engineering|privacy|opsec)\b/i.test(
      text,
    )
  )
    return "hacking";
  if (
    /\b(?:artificial intelligence|machine learning|deep learning|language model|LLMs?|GPT|Claude|Gemini|OpenAI|Anthropic|Hugging Face|inference|neural network|AI agent)\b|\bAI\b/i.test(
      text,
    )
  )
    return "ai";
  if (
    /\b(?:gaming|video games?|Steam|Nintendo|PlayStation|Xbox|Godot|Unreal Engine|game engine|game developer|itch\.io)\b/i.test(
      text,
    )
  )
    return "gaming";
  if (
    /\b(?:music|musician|album|synthesizer|Bandcamp|DAW|audio production|recording studio|Ableton)\b/i.test(
      text,
    )
  )
    return "music";
  return null;
}

/** One coherent digest desk; preserve source order and the established story cap. */
export function focusDigestStories<
  T extends { title: string; summary?: string; host?: string },
>(
  stories: readonly T[],
  count: number,
): { board: ForumFocusPillar; stories: T[] } | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const classified = stories.map((story) => ({
    story,
    board: forumFocusPillarForText(
      `${story.title} ${story.summary ?? ""} ${story.host ?? ""}`,
    ),
  }));
  const sourceOrderedBoards = new Set(
    classified.flatMap(({ board }) => (board === null ? [] : [board])),
  );
  for (const board of sourceOrderedBoards) {
    const matched = classified
      .filter((entry) => entry.board === board)
      .map((entry) => entry.story);
    if (matched.length >= count)
      return { board, stories: matched.slice(0, count) };
  }
  return null;
}
