
import { PRIMARY_SITE_URL } from "./site-urls";
import { DEVELOPER_RESOURCES } from "./developer-resources";

const origin = PRIMARY_SITE_URL;
export const DEVELOPER_INDEX_URLS = [
  // The homepage's product JSON-LD changed after the previous IndexNow batch.
  "/",
  "/developers",
  ...Object.keys(DEVELOPER_RESOURCES).map((slug) => `/developers/${slug}`),
  "/developers/sandbox",
  "/agent",
  // /agent/instructions is intentionally noindex; /agent is its HTML canonical.
  "/agents.md",
  "/auth.md",
  "/developers/llms.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/pricing",
  "/skills.sh",
].map((path) => `${origin}${path}`);

export function developerIndexNowPayload(key: string) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key))
    throw new Error("Invalid IndexNow ownership key");
  return {
    host: new URL(origin).hostname,
    key,
    keyLocation: `${origin}/indexnow-${key}.txt`,
    urlList: [...DEVELOPER_INDEX_URLS],
  };
}
