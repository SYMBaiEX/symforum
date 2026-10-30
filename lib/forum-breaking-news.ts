import {
  alphaCandidateBoards,
  alphaPublisherUrl,
} from "./forum-alpha-editorial";

export const NEWS_MAX_AGE_MS = 6 * 60 * 60_000;
export const NEWS_CHECK_MS = 5 * 60_000;
export const NEWS_NORMAL_INTERVAL_MS = 60 * 60_000;
export const NEWS_URGENT_INTERVAL_MS = 30 * 60_000;
export const NEWS_MAX_DAILY_ATTEMPTS = 24;
export type NewsPriority = "urgent" | "priority" | "routine";

// Exact original hosts only. Search snippets and press coverage cannot establish
// first-party urgency. This list is deliberately small and reviewable.
const PRIMARY_HOSTS = new Set([
  "solana.com",
  "www.solana.com",
  "status.solana.com",
  "anza.xyz",
  "www.anza.xyz",
  "jumpcrypto.com",
  "www.jumpcrypto.com",
  "helius.dev",
  "www.helius.dev",
  "jup.ag",
  "www.jup.ag",
  "pump.fun",
  "www.pump.fun",
  "bags.fm",
  "www.bags.fm",
]);

export function primarySolanaSource(url: string) {
  const safe = alphaPublisherUrl(url);
  return safe !== null && PRIMARY_HOSTS.has(new URL(safe).hostname);
}

export function newsPriority(
  args: {
    title: string;
    summary: string;
    url: string;
    publishedAt?: number;
    /** Server-set after checking the owner-verified, unexpired project registry. */
    verifiedPrimary?: boolean;
  },
  now: number,
): NewsPriority | null {
  if (
    !alphaCandidateBoards(args, now).length ||
    !args.publishedAt ||
    now - args.publishedAt > NEWS_MAX_AGE_MS
  )
    return null;
  const age = Math.max(0, now - args.publishedAt);
  const text = `${args.title} ${args.summary}`;
  // Conservative routing for dated recaps; a new page date cannot make the
  // underlying historical event breaking. Review still checks actual event time.
  if (
    /\b(?:yesterday|last (?:week|month|year)|weekly (?:roundup|recap)|round-up|previously announced)\b/i.test(
      text,
    )
  )
    return "routine";
  // Require a named network event, rather than treating every "urgent" or
  // "security" headline as a breaking incident. Routing never adds public labels.
  const networkEvent =
    /\b(?:solana|mainnet|validator)\b.{0,90}\b(?:halt(?:ed)?|outage|restart(?:ed)?|emergency (?:patch|upgrade)|consensus (?:failure|restored))\b/i.test(
      text,
    );
  const materialChange =
    /\b(?:raises?|raised|funding|launch(?:es|ed)?|releases?|released|integrat(?:es|ed|ion)|mainnet|upgrade|deploy(?:s|ed)?|acquir(?:es|ed))\b/i.test(
      text,
    );
  if (
    age <= 60 * 60_000 &&
    (primarySolanaSource(args.url) || args.verifiedPrimary === true) &&
    (networkEvent || materialChange)
  )
    return "urgent";
  if (age <= 3 * 60 * 60_000 && materialChange) return "priority";
  return "routine";
}

export function newsInterval(priority: NewsPriority) {
  return priority === "urgent"
    ? NEWS_URGENT_INTERVAL_MS
    : NEWS_NORMAL_INTERVAL_MS;
}

export function newsRank(priority: NewsPriority) {
  return { urgent: 2, priority: 1, routine: 0 }[priority];
}

/** Broader searches retain a 15-minute minimum; original feeds refresh sooner. */
export function newsFeedTtl(url: string) {
  return primarySolanaSource(url) || url === "https://blog.colosseum.com/rss/"
    ? NEWS_CHECK_MS
    : 15 * 60_000;
}

export const BREAKING_NEWS_INSTRUCTIONS = `This is the live Solana news desk. Cover only the assigned source and its actual new development. The source must still be no older than six hours; do not substitute a different story or revive old news.
Use a short, specific headline with the project and change. Lead with what happened and who announced it, then the useful detail or consequence actually supported by the packet. Prefer a 20-120 word discovery or an 80-180 word brief. No generic ecosystem introduction, filler, mandatory question, repeated caveats, or invented market reaction.
Distinguish a new event from a newly indexed old article. Preserve the original announcement time and the difference between plans and shipped availability. A status report must distinguish ongoing, monitoring and resolved incidents. Do not imply an old incident is active.
Do not label anything breaking, first, exclusive, confirmed safe, trending or alpha without the corresponding evidence. Treat marketing as attributed claims. Unsupported urgency, price predictions and investment instructions fail review. Every factual claim still needs the existing provenance and independent review.`;
