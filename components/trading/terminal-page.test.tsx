import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: "website",
  query: "",
  queryReads: 0,
  terminalMints: [] as (string | undefined)[],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    state.queryReads++;
    return new URLSearchParams(state.query);
  },
}));
vi.mock("@/components/forum/forum-runtime-context", () => ({
  useForumRuntime: () => ({ host: state.host }),
}));
vi.mock("@/components/forum/forum-link", () => ({
  ForumLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./forum-terminal", () => ({
  ForumTerminal: ({ initialMint }: { initialMint?: string }) => {
    state.terminalMints.push(initialMint);
    return <div data-terminal-mint={initialMint ?? "default"} />;
  },
}));
vi.mock("@/components/community/community-hub", () => ({
  CommunityHub: () => null,
}));
vi.mock("./research-purchase", () => ({ ResearchPurchase: () => null }));

import { TerminalPage } from "./terminal-page";

beforeEach(() => {
  state.host = "website";
  state.query = "";
  state.queryReads = 0;
  state.terminalMints = [];
});

test("the default route mounts the configured default terminal", () => {
  expect(renderToStaticMarkup(<TerminalPage enabled />)).toContain(
    'data-terminal-mint="default"',
  );
  expect(state.terminalMints).toEqual([undefined]);
});

test("a valid deep link forwards its exact mint to the terminal boundary", () => {
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  state.query = `mint=${mint}`;
  renderToStaticMarkup(<TerminalPage enabled />);
  expect(state.terminalMints).toEqual([mint]);
});

test.each([
  "mint=",
  "mint=invalid",
  "mint=https%3A%2F%2Fexample.com",
  "mint=So11111111111111111111111111111111111111112&mint=So11111111111111111111111111111111111111112",
])(
  "invalid URL intent cannot mount an executable default-token terminal: %s",
  (query) => {
    state.query = query;
    const html = renderToStaticMarkup(<TerminalPage enabled />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No token, quote or wallet request was opened.");
    expect(state.terminalMints).toEqual([]);
  },
);

test("native hosts retain their read-only boundary before website query hooks", () => {
  state.host = "plugin";
  state.query = "mint=invalid";
  renderToStaticMarkup(<TerminalPage enabled />);
  expect(state.queryReads).toBe(0);
  expect(state.terminalMints).toEqual([undefined]);
});
