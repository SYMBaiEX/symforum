// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ForumRuntimeContext } from "./forum-runtime-context";
import { SYMF_TOKEN } from "@/lib/symf-token";

const state = vi.hoisted(() => ({ pathname: "/symf", theme: "dark" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: state.theme }),
}));
import { ForumSymf } from "./forum-symf";

test.each(["/symf", "/forum/symf"])(
  "token page identifies the exact current mint and adapts discussion links on %s",
  (pathname) => {
    state.pathname = pathname;
    const html = renderToStaticMarkup(<ForumSymf />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump");
    expect(html).toContain(`https://pump.fun/coin/${SYMF_TOKEN.mint}`);
    expect(html).toContain(`https://solscan.io/token/${SYMF_TOKEN.mint}`);
    expect(html).toContain('href="https://t.me/symforum"');
    expect(html).toContain(
      `href="${pathname.startsWith("/forum") ? "/forum" : ""}/crypto-pumpfun/`,
    );
    expect(html).toContain('aria-label="Copy SYMF mint address"');
    expect(html).toContain("The older Bags token is separate");
  },
);

test.each(["dark", "light"])(
  "website uses native candle controls in %s mode with a direct external fallback",
  (theme) => {
    state.theme = theme;
    const html = renderToStaticMarkup(<ForumSymf />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain('aria-label="Candle interval"');
    expect(html).toContain("Loading verified market data");
    expect(html).toContain(
      "https://dexscreener.com/solana/BqkubRUbgk13q1imaVhKkSVZqrBoVXGc5LJi8JCL8CZr",
    );
    expect(html).toContain("GeckoTerminal");
    expect(html).toContain('aria-label="Swap SYMF"');
    expect(html).toContain("Loading wallet support");
  },
);

test("embedded Forum app keeps its no-frames policy and links to the live website chart", () => {
  const html = renderToStaticMarkup(
    <ForumRuntimeContext.Provider value={{ host: "plugin" }}>
      <ForumSymf />
    </ForumRuntimeContext.Provider>,
  );
  expect(html).not.toContain("<iframe");
  expect(html).toContain('href="https://forum.symbaiex.com/symf"');
  expect(html).toContain("Open live chart");
  expect(html).not.toContain('aria-label="Swap SYMF"');
  expect(html).toContain(SYMF_TOKEN.mint);
});
