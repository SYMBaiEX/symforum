import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { TerminalMarket } from "@/lib/forum-terminal-model";

const state = vi.hoisted(() => ({
  market: null as TerminalMarket | null,
  chart: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.market,
  useAction: () => vi.fn(),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("./price-chart", () => ({
  TokenPriceChart: (props: unknown) => {
    state.chart(props);
    return null;
  },
}));
vi.mock("./market-identity", () => ({ TokenLogo: () => null }));
vi.mock("@/components/forum/forum-link", () => ({
  ForumLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { TokenDetail } from "./token-detail";

const now = 1_800_000_000_000;
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const token = { mint, symbol: "FIXTURE", name: "Invented token" };
beforeEach(() => {
  vi.clearAllMocks();
  state.market = {
    ...token,
    platform: "other",
    observedAt: now - 3_600_000,
    metricsAsOf: now - 3_600_000,
    priceUsd: 0.0042,
    marketCapUsd: null,
    fdvUsd: 9_000_000,
    liquidityUsd: 45_000,
    volume1hUsd: 123_000,
    volume24hUsd: 234_000,
    holders: 456,
    priceChange1hPercent: -5,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: "https://example.com/original-scout",
    sourceRank: 1,
    threadId: null,
    threadUrl: null,
    marketData: {
      state: "available",
      checkedAt: now - 120_000,
      sourceUrl: "https://example.com/checked-market-pool",
    },
  };
});

test("token details forward optional market navigation without invoking it or changing the mint", () => {
  const browse = vi.fn();
  renderToStaticMarkup(
    <TokenDetail token={token} now={now} onBrowseMarkets={browse} />,
  );
  expect(state.chart).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      mint,
      compact: true,
      onBrowseMarkets: browse,
    }),
  );
  expect(browse).not.toHaveBeenCalled();
  expect(state.market?.mint).toBe(mint);
});

test("token details use refreshed metric provenance without refreshing the holder sample", () => {
  const html = renderToStaticMarkup(<TokenDetail token={token} now={now} />);
  expect(html).toContain("Checked market sample · 1h sampled");
  expect(html).toContain('href="https://example.com/checked-market-pool"');
  expect(html).not.toContain('href="https://example.com/original-scout"');
  expect(html).toContain(
    `1h volume/change checked ${new Date(now - 120_000).toLocaleString()}`,
  );
  expect(html).toContain(
    `Holders sampled ${new Date(now - 3_600_000).toLocaleString()}`,
  );
  expect(html).toContain("Stale holder sample.");
  expect(html).not.toContain("1h change is a stale sample");
  expect(state.market?.metricsAsOf).toBe(now - 3_600_000);
});

test("stale market overlays remain stale independently of the holder observation", () => {
  state.market!.marketData!.checkedAt = now - 20 * 60_000;
  const html = renderToStaticMarkup(<TokenDetail token={token} now={now} />);
  expect(html).toContain("1h change is a stale sample");
  expect(html).toContain("Stale checked market fields.");
  expect(html).toContain("Stale holder sample.");
});

test("missing refreshed pool data cannot inherit the old source or claim a current hourly change", () => {
  Object.assign(state.market!, {
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: null,
    volume1hUsd: null,
    volume24hUsd: null,
    priceChange1hPercent: null,
    marketData: { state: "unavailable", checkedAt: now, sourceUrl: null },
  });
  const html = renderToStaticMarkup(<TokenDetail token={token} now={now} />);
  expect(html).toContain("Market fields unavailable · 1h change unavailable");
  expect(html).toContain("No supported pool data was available.");
  expect(html).not.toContain('href="https://example.com/original-scout"');
  expect(html).toContain("456");
  expect(html).toContain("Stale holder sample.");
});
