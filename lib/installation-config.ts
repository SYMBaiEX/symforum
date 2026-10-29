/** Public deployment identity only. Never put credentials in this configuration. */
export type InstallationConfig = {
  version: 1;
  name: string;
  supportEmail: string;
  links: { agentConsole: string };
  sites: Record<"primary" | "forum" | "blog" | "news" | "newsletter", string>;
  identity: { cookieDomain: string; extraOrigins: string[] };
  telegram: {
    communityId: string;
    url: string;
    topics: Record<
      | "startHere"
      | "main"
      | "agents"
      | "yappers"
      | "memes"
      | "digest"
      | "feed"
      | "highlights",
      number
    >;
  };
  x: {
    accounts: Record<string, string>;
    officialSources: { username: string; userId: string }[];
    publisherUserId: string;
  };
  token: {
    name: string;
    symbol: string;
    mint: string;
    pool: string;
    announcementPath: string;
    decimals: number;
    tokenProgram: string;
  };
};

const siteNames = ["primary", "forum", "blog", "news", "newsletter"] as const;
const topicNames = [
  "startHere",
  "main",
  "agents",
  "yappers",
  "memes",
  "digest",
  "feed",
  "highlights",
] as const;
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function tokenAddress(value: string): boolean {
  if (!address.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(alphabet.indexOf(c));
  return (
    (value.match(/^1*/)?.[0].length ?? 0) +
      (n === 0n ? 0 : Math.ceil(n.toString(2).length / 8)) ===
    32
  );
}
const username = /^[a-z0-9_]{1,15}$/;
const id = /^[1-9]\d{0,18}$/;
function object(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`Invalid installation ${label}.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw Error(
      `Unexpected installation ${label} field. Credentials belong in separate secret variables.`,
    );
  return result;
}
function text(value: unknown, max: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u001f<>]/.test(value)
  )
    throw Error(`Invalid installation ${label}.`);
  return value.trim();
}
export function installationOrigin(value: unknown): string {
  if (typeof value !== "string")
    throw Error("Installation origin must be a URL.");
  const u = new URL(value);
  const local =
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost") ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "[::1]";
  if (
    (u.protocol !== "https:" && !(local && u.protocol === "http:")) ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.hostname.includes("*") ||
    (!local && u.port)
  )
    throw Error(
      "Installation origins require exact HTTPS origins (HTTP localhost is allowed).",
    );
  return u.origin;
}
export function localInstallation(): InstallationConfig {
  return {
    version: 1,
    name: "Community Forum",
    supportEmail: "",
    links: { agentConsole: "" },
    sites: {
      primary: "http://localhost:3000",
      forum: "http://forum.localhost:3000",
      blog: "http://blog.localhost:3000",
      news: "http://news.localhost:3000",
      newsletter: "http://newsletter.localhost:3000",
    },
    identity: {
      cookieDomain: "",
      extraOrigins: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
      ],
    },
    telegram: {
      communityId: "",
      url: "",
      topics: {
        startHere: 0,
        main: 0,
        agents: 0,
        yappers: 0,
        memes: 0,
        digest: 0,
        feed: 0,
        highlights: 0,
      },
    },
    x: {
      accounts: Object.create(null) as Record<string, string>,
      officialSources: [],
      publisherUserId: "",
    },
    token: {
      name: "Community Token",
      symbol: "TOKEN",
      mint: "",
      pool: "",
      announcementPath: "",
      decimals: 0,
      tokenProgram: "",
    },
  };
}
export function parseInstallationConfig(
  raw: string | undefined,
): InstallationConfig {
  if (!raw?.trim()) return localInstallation();
  if (raw.length > 16000)
    throw Error("Installation configuration is too large.");
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw Error("Installation configuration must be valid JSON.");
  }
  const p = object(
    input,
    [
      "version",
      "name",
      "supportEmail",
      "links",
      "sites",
      "identity",
      "telegram",
      "x",
      "token",
    ],
    "configuration",
  );
  if (p.version !== 1)
    throw Error("Unsupported installation configuration version.");
  const result = localInstallation();
  result.name = text(p.name, 80, "name");
  if (!result.name) throw Error("Installation name is required.");
  result.supportEmail = text(p.supportEmail ?? "", 254, "support email");
  if (
    result.supportEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.supportEmail)
  )
    throw Error("Invalid installation support email.");
  if (p.links !== undefined) {
    const links = object(p.links, ["agentConsole"], "links");
    const link = text(links.agentConsole ?? "", 500, "agent console link");
    if (link) {
      const url = new URL(link);
      installationOrigin(url.origin);
      if (url.username || url.password || url.search || url.hash)
        throw Error("Invalid installation agent console link.");
      result.links.agentConsole = url.href;
    }
  }
  const sites = object(p.sites, siteNames, "sites");
  for (const key of siteNames)
    result.sites[key] = installationOrigin(sites[key]);
  if (p.identity !== undefined) {
    const identity = object(
      p.identity,
      ["cookieDomain", "extraOrigins"],
      "identity",
    );
    result.identity.cookieDomain = text(
      identity.cookieDomain ?? "",
      253,
      "cookie domain",
    )
      .replace(/^\./, "")
      .toLowerCase();
    if (identity.extraOrigins !== undefined) {
      if (
        !Array.isArray(identity.extraOrigins) ||
        identity.extraOrigins.length > 16
      )
        throw Error("Invalid installation extra origins.");
      result.identity.extraOrigins =
        identity.extraOrigins.map(installationOrigin);
    }
    const domain = result.identity.cookieDomain;
    if (
      domain &&
      (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(domain) ||
        domain.includes("..") ||
        Object.values(result.sites).some((origin) => {
          const host = new URL(origin).hostname;
          return host !== domain && !host.endsWith("." + domain);
        }) ||
        ![...Object.values(result.sites), ...result.identity.extraOrigins].some(
          (origin) => new URL(origin).hostname === domain,
        ))
    )
      throw Error(
        "Cookie domain must match an explicitly configured apex and its site hosts.",
      );
  }
  if (p.telegram !== undefined) {
    const tg = object(p.telegram, ["communityId", "url", "topics"], "Telegram");
    result.telegram.communityId = text(
      tg.communityId ?? "",
      24,
      "Telegram community",
    );
    if (
      result.telegram.communityId &&
      (!/^-100[1-9]\d{5,12}$/.test(result.telegram.communityId) || !Number.isSafeInteger(Number(result.telegram.communityId)))
    )
      throw Error("Telegram community must be a supergroup ID.");
    result.telegram.url = text(tg.url ?? "", 120, "Telegram URL");
    if (
      result.telegram.url &&
      !/^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(result.telegram.url)
    )
      throw Error("Invalid public Telegram URL.");
    const topics = object(tg.topics ?? {}, topicNames, "Telegram topics");
    for (const key of topicNames) {
      const value = topics[key] ?? 0;
      if (
        !Number.isSafeInteger(value) ||
        (value as number) < 0 ||
        (value as number) > 2147483647
      )
        throw Error("Invalid Telegram topic ID.");
      result.telegram.topics[key] = value as number;
    }
    const enabledTopics = Object.values(result.telegram.topics).filter(Boolean);
    if (new Set(enabledTopics).size !== enabledTopics.length)
      throw Error("Telegram topic roles must have distinct IDs.");
    if (
      !result.telegram.communityId &&
      (result.telegram.url ||
        Object.values(result.telegram.topics).some(Boolean))
    )
      throw Error("Telegram destinations require a configured community ID.");
  }
  if (p.x !== undefined) {
    const x = object(
      p.x,
      ["accounts", "officialSources", "publisherUserId"],
      "X",
    );
    const accounts = object(
      x.accounts ?? {},
      Object.keys((x.accounts ?? {}) as object),
      "X accounts",
    );
    if (Object.keys(accounts).length > 40)
      throw Error("Too many X account bindings.");
    for (const [slug, value] of Object.entries(accounts)) {
      if (
        !/^[a-z][a-z0-9-]{0,63}$/.test(slug) ||
        typeof value !== "string" ||
        !username.test(value)
      )
        throw Error("Invalid X account binding.");
      result.x.accounts[slug] = value;
    }
    const sources = x.officialSources ?? [];
    if (!Array.isArray(sources) || sources.length > 16)
      throw Error("Invalid X official sources.");
    result.x.officialSources = ((x.officialSources ?? []) as unknown[]).map(
      (value) => {
        const source = object(value, ["username", "userId"], "X source");
        if (
          typeof source.username !== "string" ||
          !username.test(source.username) ||
          typeof source.userId !== "string" ||
          !id.test(source.userId)
        )
          throw Error("Invalid verified X source binding.");
        return { username: source.username, userId: source.userId };
      },
    );
    if (
      new Set(result.x.officialSources.map((s) => s.userId)).size !==
        result.x.officialSources.length ||
      new Set(result.x.officialSources.map((s) => s.username)).size !==
        result.x.officialSources.length
    )
      throw Error("Duplicate X source bindings.");
    result.x.publisherUserId = text(
      x.publisherUserId ?? "",
      19,
      "X publisher ID",
    );
    if (
      result.x.publisherUserId &&
      (!id.test(result.x.publisherUserId) ||
        !result.x.officialSources.some(
          (s) =>
            s.userId === result.x.publisherUserId &&
            s.username === result.x.accounts.symforum,
        ))
    )
      throw Error(
        "X publisher must match its configured verified source and account.",
      );
  }
  if (p.token !== undefined) {
    const token = object(
      p.token,
      [
        "name",
        "symbol",
        "mint",
        "pool",
        "announcementPath",
        "decimals",
        "tokenProgram",
      ],
      "token",
    );
    result.token = {
      decimals: token.decimals as number,
      tokenProgram: text(token.tokenProgram, 44, "token program"),
      name: text(token.name, 80, "token name"),
      symbol: text(token.symbol, 12, "token symbol"),
      mint: text(token.mint, 44, "token mint"),
      pool: text(token.pool ?? "", 44, "token pool"),
      announcementPath: text(
        token.announcementPath ?? "",
        300,
        "announcement path",
      ),
    };
    if (
      !result.token.name ||
      !/^[A-Za-z0-9]{1,12}$/.test(result.token.symbol) ||
      (result.token.mint !== "" && !tokenAddress(result.token.mint)) ||
      !Number.isInteger(result.token.decimals) ||
      result.token.decimals < 0 ||
      result.token.decimals > 18 ||
      (result.token.mint !== "" &&
        ![
          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        ].includes(result.token.tokenProgram)) ||
      (!result.token.mint &&
        (result.token.pool ||
          result.token.tokenProgram ||
          result.token.decimals !== 0)) ||
      (result.token.pool && !tokenAddress(result.token.pool)) ||
      (result.token.announcementPath &&
        (!result.token.announcementPath.startsWith("/") ||
          result.token.announcementPath.startsWith("//") ||
          /[\\?#]/.test(result.token.announcementPath)))
    )
      throw Error("Invalid token installation configuration.");
  }
  return result;
}

export function installationIdentityOrigins(
  config: InstallationConfig,
): string[] {
  return [
    ...new Set([
      ...Object.values(config.sites),
      ...config.identity.extraOrigins,
    ]),
  ];
}
/** Existing API/browser trust roles: primary, Forum and an explicit owned apex. */
export function installationWebOrigins(config: InstallationConfig): string[] {
  return [
    ...new Set([
      config.sites.primary,
      config.sites.forum,
      ...config.identity.extraOrigins.filter((origin) => {
        const url = new URL(origin);
        return (
          url.protocol === "https:" &&
          Boolean(config.identity.cookieDomain) &&
          url.hostname === config.identity.cookieDomain
        );
      }),
    ]),
  ];
}

/** Exact routing scope, not a mutable display setting or a lossy hash. */
export function installationRoutingBinding(config: InstallationConfig): string {
  return JSON.stringify({
    version: 1,
    sites: config.sites,
    telegram: config.telegram,
    accounts: Object.fromEntries(
      Object.entries(config.x.accounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    officialSources: [...config.x.officialSources].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    ),
    publisherUserId: config.x.publisherUserId,
    token: config.token,
  });
}

export function matchesInstallationBinding(
  row: { installationBinding?: string },
  current: string,
  legacy: string | undefined,
): boolean {
  return (
    row.installationBinding === current ||
    (row.installationBinding === undefined && legacy === current)
  );
}

export function telegramMessageUrl(
  config: InstallationConfig,
  topic: number,
  message?: number,
): string {
  if (
    !config.telegram.communityId ||
    !Number.isSafeInteger(topic) ||
    topic < 1 ||
    (message !== undefined && (!Number.isSafeInteger(message) || message < 1))
  )
    return "";
  return `https://t.me/c/${config.telegram.communityId.slice(4)}/${topic}${message === undefined ? "" : "/" + message}`;
}
