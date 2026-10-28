/** Shared X application; account grants and draft intents remain per persona. */
import { ELIZA_EDITORIAL_PERSONAS } from "./eliza-runtime-personas";

export const X_AGENT_SLUGS = new Set<string>(ELIZA_EDITORIAL_PERSONAS);
export const X_CALLBACK_URL =
  "https://forum.symbaiex.com/api/agents/x/callback";
export const X_CONSOLE_URL =
  "https://forum.symbaiex.com/control-panel/x-accounts";
export const X_DRAFT_SCOPES = ["tweet.read", "users.read", "offline.access"];
export const X_AUTH_TTL_MS = 10 * 60_000;
export const X_DRAFT_TTL_MS = 15 * 60_000;

export function xUsername(value: string) {
  const result = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(result)) throw Error("Invalid X username.");
  return result;
}

export function expectedXUsername(slug: string, input: string) {
  const username = xUsername(input);
  if (slug === "nyx" && username !== "symbaiex_nyx")
    throw Error("NyX must connect @symbaiex_nyx.");
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

export function xAuthorizationUrl(state: string, challenge: string) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    redirect_uri: X_CALLBACK_URL,
    scope: X_DRAFT_SCOPES.join(" "),
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
