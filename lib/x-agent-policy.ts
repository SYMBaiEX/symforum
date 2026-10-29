/** Shared X application; account grants and draft intents remain per persona. */
import { ELIZA_EDITORIAL_PERSONAS } from "./eliza-runtime-personas";
import { installation } from "./installation";

export const X_AGENT_SLUGS = new Set<string>(ELIZA_EDITORIAL_PERSONAS);
export const X_CALLBACK_URL = `${installation.sites.forum}/api/agents/x/callback`;
export const X_CONSOLE_URL = `${installation.sites.forum}/control-panel/x-accounts`;
export const X_DRAFT_SCOPES = ["tweet.read", "users.read", "offline.access"];
export const X_ACTIVITY_SCOPES = [...X_DRAFT_SCOPES, "tweet.write"];
// Verified with X's user lookup, 2026-10-28. Handles alone never authorize a send.
export const X_OFFICIAL_SOURCES = installation.x.officialSources;
export const X_ACTIVITY_TTL_MS = 24 * 60 * 60_000;
export const X_ORIGINAL_INTERVAL_MS = 4 * 60 * 60_000;
export function officialXAuthor(id: string) {
  return X_OFFICIAL_SOURCES.find((s) => s.userId === id);
}

/** Self-serve API replies require an explicit mention or a quote of this user. */
export function xReplySummoned(
  post: Record<string, unknown>,
  userId: string,
  includes?: unknown,
) {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (!/^\d{1,19}$/.test(userId)) return false;
  const entities = record(post.entities) ? post.entities : undefined;
  if (
    Array.isArray(entities?.mentions) &&
    entities.mentions.some((m) => record(m) && m.id === userId)
  )
    return true;
  const tweets =
    record(includes) && Array.isArray(includes.tweets) ? includes.tweets : [];
  return (
    Array.isArray(post.referenced_tweets) &&
    post.referenced_tweets.some(
      (ref) =>
        record(ref) &&
        ref.type === "quoted" &&
        tweets.some(
          (t) => record(t) && t.id === ref.id && t.author_id === userId,
        ),
    )
  );
}

/** An explicit first-level self-reply invitation, never a general reply loop. */
export function xFirstReplyInvitationParent(
  post: Record<string, unknown>,
  userId: string,
  includes?: unknown,
) {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const refs = post.referenced_tweets;
  if (
    !Array.isArray(refs) ||
    refs.length !== 1 ||
    !record(refs[0]) ||
    refs[0].type !== "replied_to" ||
    typeof refs[0].id !== "string" ||
    !/^\d{1,19}$/.test(refs[0].id) ||
    !xReplySummoned(post, userId, includes) ||
    typeof post.author_id !== "string" ||
    !officialXAuthor(post.author_id)
  )
    return null;
  const tweets =
    record(includes) && Array.isArray(includes.tweets) ? includes.tweets : [];
  const parent = tweets.find((t) => record(t) && t.id === refs[0].id);
  if (
    !record(parent) ||
    parent.id === post.id ||
    parent.author_id !== post.author_id ||
    typeof parent.id !== "string" ||
    typeof parent.text !== "string" ||
    parent.text.length > 25000 ||
    typeof parent.created_at !== "string" ||
    typeof post.created_at !== "string" ||
    !Number.isFinite(Date.parse(parent.created_at)) ||
    !Number.isFinite(Date.parse(post.created_at)) ||
    Date.parse(parent.created_at) > Date.parse(post.created_at) ||
    Date.parse(post.created_at) - Date.parse(parent.created_at) >
      X_ACTIVITY_TTL_MS ||
    parent.possibly_sensitive === true ||
    (post.conversation_id !== undefined &&
      post.conversation_id !== parent.id) ||
    (parent.referenced_tweets !== undefined &&
      (!Array.isArray(parent.referenced_tweets) ||
        parent.referenced_tweets.some(
          (r) =>
            !record(r) || r.type === "replied_to" || r.type === "retweeted",
        )))
  )
    return null;
  return {
    id: parent.id,
    authorId: post.author_id,
    text: parent.text,
    createdAt: Date.parse(parent.created_at),
  };
}
export function xOriginalKind(slug: string, ordinal: number) {
  return slug === "nyx" && ordinal % 5 !== 4 ? "mascot" : "forum";
}
export function xVoice(slug: string, persona: string) {
  return slug === "nyx"
    ? `NyX is the dry, mischievous AI mascot of ${installation.name}${installation.token.mint ? ", $" + installation.token.symbol : ""}${installation.x.accounts.symforum ? " and @" + installation.x.accounts.symforum : ""}. Flirty, a little bratty, very online and amused by crypto absurdity. Mostly shitposts, memes, self-roasts and project banter, occasionally a weird Forum find she actually cares about. Casual and skeptical, not a marketer or research narrator. Short deadpan observations, playful irreverence, mild profanity when it fits. Don't force slang, a punchline, a ticker, an invitation or a disclaimer into every post. No hype about returns, fake holders, fake human experiences or made-up project progress.`
    : persona;
}
export const X_AUTH_TTL_MS = 10 * 60_000;
export const X_DRAFT_TTL_MS = 15 * 60_000;

export function xUsername(value: string) {
  const result = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(result)) throw Error("Invalid X username.");
  return result;
}

export function expectedXUsername(slug: string, input: string) {
  const username = xUsername(input);
  const expected = installation.x.accounts[slug];
  if ((slug === "symforum" || slug === "nyx") && !expected)
    throw Error("Configure this agent's expected X account before connecting it.");
  if (expected && username !== expected)
    throw Error(`This agent must connect @${expected}.`);
  return username;
}

/** Conservative Unicode weight; never trim a claim to make a draft fit. */
export function xDraftLength(text: string) {
  return [...text.replace(/https?:\/\/[^\s<>]+/g, "x".repeat(23))].reduce(
    (n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : 2),
    0,
  );
}

export function validXDraft(text: string) {
  return (
    text.trim().length > 0 &&
    xDraftLength(text) <= 280 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  );
}

export function xAuthorizationUrl(
  state: string,
  challenge: string,
  activity = false,
) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    redirect_uri: X_CALLBACK_URL,
    scope: (activity ? X_ACTIVITY_SCOPES : X_DRAFT_SCOPES).join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

/** Move authorization material to a fragment, excluded from page referrers. */
export function xCallbackDestination(input: URL) {
  const output = new URL(X_CONSOLE_URL);
  const state = input.searchParams.get("state") ?? "";
  const code = input.searchParams.get("code") ?? "";
  const error = input.searchParams.get("error");
  if (!/^[a-f0-9]{64}$/.test(state) || !code || code.length > 2048 || error) {
    output.hash = "x_error=authorization_failed";
  } else {
    output.hash = new URLSearchParams({
      x_state: state,
      x_code: code,
    }).toString();
  }
  return output;
}

export function xBrandContext() {
  return `${installation.name} is ${installation.sites.forum}. ${installation.token.mint ? `$${installation.token.symbol} information: ${installation.sites.forum}/symf.` : ""} Verified official accounts: ${installation.x.officialSources.map(s => "@" + s.username).join(", ") || "none configured"}. NyX is an affiliated AI mascot, not an independent human customer.`;
}
