import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/trading/terminal-page", () => ({
  TerminalPage: () => null,
}));

import TradePage from "@/apps/platform/app/forum/trade/page";
import TradeRedirect from "@/apps/platform/app/trade/page";

beforeEach(() => {
  redirect.mockClear();
});

test("only the shared trade page opts into the full-width terminal frame", () => {
  const html = renderToStaticMarkup(createElement(TradePage));
  expect(html).toContain('data-forum-layout="terminal"');
  expect(html).toContain('class="page-frame page-frame-dense"');
});

const redirects: [string | string[] | undefined, string][] = [
  [undefined, "/forum/trade"],
  [
    "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
    "/forum/trade?mint=5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  ],
  ["", "/forum/trade?mint=invalid"],
  ["javascript:alert(1)", "/forum/trade?mint=invalid"],
  [
    [
      "So11111111111111111111111111111111111111112",
      "So11111111111111111111111111111111111111112",
    ],
    "/forum/trade?mint=invalid",
  ],
];
test.each(redirects)(
  "the platform entry retains token intent: %s",
  async (mint, href) => {
    await expect(
      TradeRedirect({
        searchParams: Promise.resolve({
          mint: Array.isArray(mint) ? [...mint] : mint,
        }),
      }),
    ).rejects.toThrow(`REDIRECT:${href}`);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(href);
  },
);
