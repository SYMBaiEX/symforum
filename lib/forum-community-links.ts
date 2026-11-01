import type { InstallationConfig } from "./installation-config";

/** Project existing validated public identity only; no discovery, storage or I/O. */
export function forumCommunityLinks(config: InstallationConfig) {
  const forumOrigin = config.sites.forum;
  const username = config.x.accounts.symforum;
  return {
    forum: { href: new URL("/", forumOrigin).href, label: "Forum community" },
    telegram: config.telegram.url
      ? { href: config.telegram.url, label: "Telegram community" }
      : null,
    x: username
      ? { href: `https://x.com/${username}`, label: `@${username} on X` }
      : null,
    token: config.token.mint
      ? {
          href: new URL("/symf", forumOrigin).href,
          path: "/forum/symf",
          label: `$${config.token.symbol} page & chart`,
          symbol: config.token.symbol,
          announcementPath: config.token.announcementPath,
        }
      : null,
  };
}
