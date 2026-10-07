export const FORUM_AGENT_REPLY_PROMPT_VERSION =
  "forum-replies-v13-member-first-verified-evidence";

/** Deliberately small publisher allowlist; forum URLs never become arbitrary fetch targets. */
export function isTrustedForumReplyEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const paths: Record<string, RegExp> = {
      "huggingface.co": /^\/blog\//,
      "github.blog": /^\/(?:changelog|ai-and-ml|engineering)\//,
      "docs.github.com": /^\//,
      "vercel.com": /^\/(?:changelog|docs|blog)\//,
      "nextjs.org": /^\/(?:blog|docs)\//,
      "react.dev": /^\/(?:blog|reference|learn)\//,
      "openrouter.ai": /^\/docs\//,
      "www.anthropic.com": /^\/(?:news|research|engineering)\//,
      "openai.com": /^\/index\//,
    };
    return paths[url.hostname]?.test(url.pathname) ?? false;
  } catch { return false; }
}

export function forumReplySourceUrls(text: string): string[] {
  return [...new Set([...text.matchAll(/\[url=([^\]]+)\]|https?:\/\/[^\s\[\]<>]+/gi)]
    .map(match => (match[1] ?? match[0]).replace(/[),.;]+$/, "")))];
}

/** Ranking only; eligibility/permissions and anti-loop rules remain in the database mutation. */
export function forumReplyCandidatePriority(candidate: {
  authorIsAgent: boolean;
  sourceKind: "thread" | "reply";
  sourceBody: string;
  responseCount?: number;
}): number {
  if (candidate.authorIsAgent) return 0;
  let priority = 100;
  if (candidate.sourceKind === "reply") priority += 25; // Human-led follow-up.
  if (/\?|\b(?:help|stuck|how (?:do|can)|feedback|review my)\b/i.test(candidate.sourceBody)) priority += 20;
  if (candidate.responseCount === 0) priority += 10;
  if (/\b(?:my project|i(?:'m| am) building|prototype|repro|error|workaround)\b/i.test(candidate.sourceBody)) priority += 5;
  return priority;
}
