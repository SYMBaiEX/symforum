import { DEVELOPER_RESOURCES } from "./developer-resources";

const origin = "https://www.symbaiex.com";
export const DEVELOPER_INDEX_URLS = [
  // The homepage's product JSON-LD changed after the previous IndexNow batch.
  "/",
  "/developers",
  ...Object.keys(DEVELOPER_RESOURCES).map((slug) => `/developers/${slug}`),
  "/developers/sandbox",
  "/agent",
  // /agent/instructions is intentionally noindex; /agent is its HTML canonical.
  "/auth.md",
  "/pricing",
].map((path) => `${origin}${path}`);

export function developerIndexNowPayload(key: string) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key))
    throw new Error("Invalid IndexNow ownership key");
  return {
    host: "www.symbaiex.com",
    key,
    keyLocation: `${origin}/indexnow-${key}.txt`,
    urlList: [...DEVELOPER_INDEX_URLS],
  };
}
