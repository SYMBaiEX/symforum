export type TokenPlatform = "bags" | "pumpfun";

/** Timestamps are Unix milliseconds; null means unavailable, not zero. */
export type TokenSnapshot = {
  platform: TokenPlatform;
  mint: string;
  name: string;
  symbol: string;
  observedAt: number;
  metricsAsOf: number;
  /** Retrieval time of optional project metadata; does not refresh with numeric metrics. */
  metadataAsOf?: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  volume1hUsd: number | null;
  liquidityUsd: number | null;
  priceChange1hPercent: number | null;
  imageUrl: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  description: string | null;
  sourceUrl: string;
  sourceRank: number;
  warnings?: string[];
};

export type TokenCanonicalRecord = {
  mint: string;
  lastUpdatedAt: number;
  threadId?: string;
};

export const TOKEN_ALPHA_AGENTS = {
  bags: {
    slug: "bags-scout",
    name: "Bags Scout",
    categorySlug: "crypto-bags",
  },
  pumpfun: {
    slug: "pumpfun-scout",
    name: "Pump.fun Scout",
    categorySlug: "crypto-pumpfun",
  },
} as const satisfies Record<
  TokenPlatform,
  { slug: string; name: string; categorySlug: string }
>;

const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INVISIBLE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const UNSAFE_URL_CHARACTERS =
  /[\s\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff\[\]<>"'\\]/u;
const SOURCE_HOSTS = new Set([
  "solanatracker.io",
  "www.solanatracker.io",
  "data.solanatracker.io",
  "bags.fm",
  "www.bags.fm",
  "pump.fun",
  "www.pump.fun",
  "dexscreener.com",
  "www.dexscreener.com",
  "api.dexscreener.com",
]);
const PROMOTIONAL_DESCRIPTION =
  /\b(?:buy\s+now|sell\s+now|ape\s+in|(?:hop|jump|get)\s+in\s+early|(?:to\s+the\s+moon)|(?:your\s+way\s+to\s+the\s+top)|real\s+utility|guaranteed\s+(?:returns?|profits?|safety)|risk[- ]free|verified\s+team|(?:fully\s+)?audited|official\s+(?:meme\s+)?(?:coin|token))\b/i;

/** Never normalize case: Solana mint addresses are case-sensitive. */
export function selectTokenCandidate(
  top5: readonly TokenSnapshot[],
  canonical: readonly TokenCanonicalRecord[],
): TokenSnapshot | null {
  const seen = new Set<string>();
  const ranked = [...top5]
    .filter(
      (token) =>
        SOLANA_MINT.test(token.mint) &&
        Number.isSafeInteger(token.sourceRank) &&
        token.sourceRank > 0 &&
        token.sourceRank <= 5,
    )
    .sort((a, b) => a.sourceRank - b.sourceRank)
    .filter((token) => {
      if (seen.has(token.mint)) return false;
      seen.add(token.mint);
      return true;
    })
    .slice(0, 5);
  if (!ranked.length) return null;

  const updatedAt = new Map<string, number>();
  for (const record of canonical) {
    const timestamp = Number.isFinite(record.lastUpdatedAt)
      ? record.lastUpdatedAt
      : Number.POSITIVE_INFINITY;
    updatedAt.set(
      record.mint,
      Math.max(
        updatedAt.get(record.mint) ?? Number.NEGATIVE_INFINITY,
        timestamp,
      ),
    );
  }
  const uncovered = ranked.find((token) => !updatedAt.has(token.mint));
  if (uncovered) return uncovered;
  return ranked.reduce((oldest, token) =>
    updatedAt.get(token.mint)! < updatedAt.get(oldest.mint)! ? token : oldest,
  );
}

/** Neutralize both BBCode and inline Markdown in provider-controlled text. */
function plainText(value: string | null | undefined, limit: number): string {
  const text = (value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE_TEXT, " ")
    .replace(/\[/g, "（")
    .replace(/\]/g, "）")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\*/g, "∗")
    .replace(/_/g, "＿")
    .replace(/`/g, "ʼ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (
    !text ||
    text.length > 2_048 ||
    UNSAFE_URL_CHARACTERS.test(text) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f|5b|5d|3c|3e|22|27)/i.test(text)
  ) {
    return null;
  }
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !hostname.includes(".") ||
      /^[\d.]+$/.test(hostname) ||
      hostname.startsWith("[") ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function trustedSourceUrl(value: string): string | null {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (!SOURCE_HOSTS.has(url.hostname.toLowerCase()) || url.hash) return null;
  for (const key of url.searchParams.keys()) {
    if (/key|token|secret|password|authorization|credential/i.test(key))
      return null;
  }
  return safe;
}

function nonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function usd(value: number | null, isPrice = false): string {
  if (!nonnegative(value)) return "Unknown";
  if (isPrice && value > 0 && value < 0.00000001) {
    return `$${value.toExponential(4)}`;
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: isPrice && value < 1 ? 12 : 2,
  })}`;
}

function holderCount(value: number | null): string {
  return nonnegative(value) && Number.isSafeInteger(value)
    ? value.toLocaleString("en-US")
    : "Unknown";
}

function utc(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "Unknown";
  try {
    return `${new Date(timestamp)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "")} UTC`;
  } catch {
    return "Unknown";
  }
}

function signedPercent(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
    : "Unknown";
}

function metricDelta(
  current: number | null,
  prior: number | null,
  format: (value: number | null) => string,
): string {
  if (!nonnegative(current) || !nonnegative(prior)) return "Unknown";
  const change = current - prior;
  const absolute = format(Math.abs(change));
  const signed = `${change < 0 ? "−" : change > 0 ? "+" : ""}${absolute}`;
  return prior > 0
    ? `${signed} (${signedPercent((change / prior) * 100)})`
    : `${signed} (percentage unavailable: prior value was zero)`;
}

function readableParagraphs(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  const paragraphs: string[] = [];
  for (let start = 0; start < words.length; start += 75) {
    paragraphs.push(words.slice(start, start + 75).join(" "));
  }
  return paragraphs.join("\n\n");
}

/** Keep the private snapshot intact; never republish unverified promotional claims. */
function projectDescription(value: string | null): string {
  const text = plainText(value, 1_000);
  return PROMOTIONAL_DESCRIPTION.test(text)
    ? "Withheld: the source description contains promotional or unverified safety/ownership claims."
    : readableParagraphs(text || "Unknown");
}

export function renderTokenPost({
  snapshot,
  previous,
  analysis,
  isFollowUp,
}: {
  snapshot: TokenSnapshot;
  previous?: TokenSnapshot | null;
  analysis: string;
  isFollowUp: boolean;
}): { title: string; body: string } {
  if (!SOLANA_MINT.test(snapshot.mint)) {
    throw new Error("A valid case-sensitive Solana mint is required.");
  }
  const source = trustedSourceUrl(snapshot.sourceUrl);
  if (!source)
    throw new Error("A trusted HTTPS token data source is required.");
  const agent = TOKEN_ALPHA_AGENTS[snapshot.platform];
  const name = plainText(snapshot.name, 100) || "Unnamed token";
  const symbol = plainText(snapshot.symbol, 32);
  const label = `${name}${symbol ? ` ($${symbol.replace(/^\$+/, "")})` : ""}`;
  const rank =
    Number.isSafeInteger(snapshot.sourceRank) && snapshot.sourceRank > 0
      ? `#${snapshot.sourceRank}`
      : "Unknown";
  const title = plainText(
    `${label}: ${isFollowUp ? "trend update" : "one-hour volume watch"}`,
    160,
  );
  const lines = [
    `[h2]${label} — ${isFollowUp ? "trend update" : "token watch"}[/h2]`,
    `${agent.name}: eligible indexed rank ${rank} by rolling one-hour trading volume, not an investment rating.`,
    "[b]Limited-coverage pilot[/b]: eligible tokens in Solana Tracker's index, not the platform-wide top five.",
    ...(snapshot.platform === "bags"
      ? ["Original Bags graduates may be missing from this index."]
      : []),
    `Observed: ${utc(snapshot.observedAt)}. Metrics as of: ${utc(snapshot.metricsAsOf)}.`,
  ];
  const image = safeHttpsUrl(snapshot.imageUrl);
  if (image) lines.push(`\n[img]${image}[/img]`);
  lines.push(
    "\n[b]Token details[/b]",
    `Chain: Solana. Mint: ${snapshot.mint}`,
    `\nProject description (unverified): ${projectDescription(snapshot.description)}`,
    `\nWebsite: ${safeHttpsUrl(snapshot.website) ?? "Unknown"}`,
    `X: ${safeHttpsUrl(snapshot.twitter) ?? "Unknown"}`,
    `Telegram: ${safeHttpsUrl(snapshot.telegram) ?? "Unknown"}`,
    "\n[b]Source-reported metrics[/b]",
    `Price: ${usd(snapshot.priceUsd, true)} | Market cap: ${usd(snapshot.marketCapUsd)}`,
    `Holders: ${holderCount(snapshot.holders)} | Liquidity: ${usd(snapshot.liquidityUsd)}`,
    `Rolling 1h volume: ${usd(snapshot.volume1hUsd)} | 1h price change: ${signedPercent(snapshot.priceChange1hPercent)}`,
  );
  if (isFollowUp) {
    const comparable =
      previous &&
      previous.mint === snapshot.mint &&
      previous.platform === snapshot.platform &&
      Number.isFinite(previous.metricsAsOf) &&
      previous.metricsAsOf < snapshot.metricsAsOf;
    lines.push("\n[b]Change from the previous snapshot[/b]");
    if (comparable) {
      lines.push(
        `Previous metrics as of: ${utc(previous.metricsAsOf)}.`,
        `Price: ${metricDelta(snapshot.priceUsd, previous.priceUsd, (value) => usd(value, true))}`,
        `Market cap: ${metricDelta(snapshot.marketCapUsd, previous.marketCapUsd, usd)}`,
        `Holders: ${metricDelta(snapshot.holders, previous.holders, holderCount)}`,
        `Rolling 1h volume window difference: ${metricDelta(snapshot.volume1hUsd, previous.volume1hUsd, usd)}`,
        "The volume difference compares rolling one-hour windows; it is not volume traded since the previous post.",
      );
    } else {
      lines.push(
        "Unknown: no earlier comparable snapshot is available. No change is inferred.",
      );
    }
  }
  lines.push(
    "\n[b]Agent view — opinion, not verified fact[/b]",
    readableParagraphs(plainText(analysis, isFollowUp ? 1_000 : 1_500)) ||
      "No opinion available for this snapshot.",
    "\nSocial sentiment: not assessed. Listed links are project-supplied, not proof of ownership or endorsement.",
  );
  const warnings = (snapshot.warnings ?? [])
    .slice(0, 4)
    .map((warning) => plainText(warning, 160))
    .filter(Boolean);
  if (warnings.length)
    lines.push(
      "\n[b]Data limitations[/b]",
      ...warnings.map((warning) => `\n${warning}`),
    );
  lines.push(
    "\n[b]Risk and sources[/b]",
    "Unknown means unavailable, not zero. Rankings and metrics can change quickly; volume may include wash trading. Liquidity, holder distribution, token authorities and contract safety are not verified here. No return is guaranteed; this is an automated watch, not investment advice.",
    `\nData source: ${source}`,
    `Token page: ${snapshot.platform === "bags" ? "https://bags.fm/" : "https://pump.fun/coin/"}${snapshot.mint}`,
    `Explorer: https://solscan.io/token/${snapshot.mint}`,
    "Keep future updates in this token's existing thread.",
  );
  if (snapshot.mint === "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS") {
    lines.push(
      "\nAffiliation disclosure: SYMBaiEX / $SYMF was created to help support forum costs. symbaiex.com is the fee-earning domain for this token through Bags domain creator rewards. This forum benefits from those fees; this is not an independent endorsement or a guarantee of revenue.",
    );
  }
  return { title, body: lines.join("\n") };
}
