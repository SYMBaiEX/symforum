import { describe, expect, test } from "vitest";
import {
  ALPHA_DESKS,
  alphaCandidateBoards,
  alphaPublisherUrl,
  alphaPagePublishedAt,
  alphaOriginalPublicationTime,
  alphaShareText,
  alphaLeadMs,
  alphaProjectMention,
  alphaTelegramText,
} from "./forum-alpha-editorial";
import { alphaPublicAddress } from "./alpha-public-fetch";
const now = Date.UTC(2026, 9, 29, 18);
const candidate = {
  title: "Solana project announces mainnet launch",
  summary: "A new deployment",
  url: "https://project.org/news",
  publishedAt: now - 60_000,
};
describe("fresh Solana editorial", () => {
  test("retains the oldest known publication time across page and feed evidence", () => {
    expect(
      alphaOriginalPublicationTime({
        publishedAt: now - 5 * 3600_000,
        originalPublishedAt: now - 60_000,
      }),
    ).toBe(now - 5 * 3600_000);
    expect(
      alphaOriginalPublicationTime({
        publishedAt: now - 60_000,
        originalPublishedAt: now - 7 * 3600_000,
      }),
    ).toBe(now - 7 * 3600_000);
    expect(alphaOriginalPublicationTime({ publishedAt: now })).toBe(now);
    expect(alphaOriginalPublicationTime({ originalPublishedAt: now })).toBe(
      now,
    );
    expect(alphaOriginalPublicationTime({ publishedAt: NaN })).toBeUndefined();
  });
  test("Telegram keeps a complete reviewed paragraph including its qualifier", () => {
    expect(
      alphaTelegramText(
        "Launch",
        "[b]Seven portfolios[/b] are available outside the US.\n\nMore details.",
      ),
    ).toBe("Launch\n\nSeven portfolios are available outside the US.");
    expect(
      alphaTelegramText("Launch", "x".repeat(901) + " outside the US."),
    ).toBe("Launch");
    expect(
      alphaTelegramText("Launch", "<unsupported>format</unsupported>"),
    ).toBe("Launch");
  });
  test("assigns a majority across all three desks", () => {
    expect(Object.keys(ALPHA_DESKS)).toHaveLength(24);
    expect(new Set(Object.values(ALPHA_DESKS).map((d) => d.board)).size).toBe(
      3,
    );
  });
  test("requires known fresh dates and ecosystem relevance", () => {
    expect(alphaCandidateBoards(candidate, now)).toEqual(["crypto"]);
    for (const publishedAt of [
      undefined,
      NaN,
      now - 25 * 3600_000,
      now + 6 * 60_000,
    ])
      expect(alphaCandidateBoards({ ...candidate, publishedAt }, now)).toEqual(
        [],
      );
    expect(
      alphaCandidateBoards(
        { ...candidate, title: "Bags radio app launches in India" },
        now,
      ),
    ).toEqual([]);
  });
  test("routes platform stories to their own subboards", () => {
    expect(
      alphaCandidateBoards(
        { ...candidate, title: "Pump.fun announces launch" },
        now,
      ),
    ).toContain("crypto-pumpfun");
    expect(
      alphaCandidateBoards(
        { ...candidate, title: "Bags.fm announces launch" },
        now,
      ),
    ).toContain("crypto-bags");
  });
  test("unwraps one RSS tracker URL without requesting Bing", () => {
    expect(
      alphaPublisherUrl(
        "http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fproject.org%2Fnews",
      ),
    ).toBe(candidate.url);
    expect(
      alphaPublisherUrl(
        "https://www.bing.com/news/apiclick.aspx?url=https://project.org&url=https://other.org",
      ),
    ).toBeNull();
  });
  test.each([
    "http://project.org/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://service.internal/",
    "https://user:secret@project.org/",
    "https://project.org:8443/",
  ])("rejects unsafe publisher %s", (u) =>
    expect(alphaPublisherUrl(u)).toBeNull(),
  );
  test.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("rejects resolved non-public IP %s", (ip) =>
    expect(alphaPublicAddress(ip)).toBe(false),
  );
  test("retains original publication date instead of modification date", () => {
    expect(
      alphaPagePublishedAt(
        '<meta content="2026-10-28T15:00:00Z" property="article:published_time"><meta property="article:modified_time" content="2026-10-29T18:00:00Z">',
      ),
    ).toBe(Date.parse("2026-10-28T15:00:00Z"));
    expect(
      alphaPagePublishedAt(
        '<script>{"datePublished":"2026-10-29T16:00:00Z"}</script>',
      ),
    ).toBe(Date.parse("2026-10-29T16:00:00Z"));
  });
  test("shares complete headlines with only supplied verified tags", () => {
    expect(
      alphaShareText(
        "Project @random launches",
        "https://forum.symbaiex.com/crypto/project",
        ["official", "official"],
      ),
    ).toBe(
      "Project random launches\n@official\n\nhttps://forum.symbaiex.com/crypto/project",
    );
    expect(
      alphaShareText(
        "x".repeat(181),
        "https://forum.symbaiex.com/crypto/project",
      ),
    ).toBeNull();
    expect(alphaShareText("hi", "https://evil.org/crypto/post")).toBeNull();
  });
  test("uses bounded configurable Telegram lead", () => {
    expect(alphaLeadMs()).toBe(30 * 60_000);
    expect(alphaLeadMs("0")).toBe(30 * 60_000);
    expect(alphaLeadMs("15")).toBe(15 * 60_000);
  });
});

test("verified project names match full words in relevant coverage", () => {
  expect(
    alphaProjectMention(
      "Ondo Finance",
      "New portfolios",
      "Ondo Finance launched seven portfolios",
    ),
  ).toBe(true);
  expect(
    alphaProjectMention(
      "Ondo Finance",
      "New portfolios",
      "FakeOndo FinancePlus launched portfolios",
    ),
  ).toBe(false);
  expect(alphaProjectMention(undefined, "Ondo Finance launched", "text")).toBe(
    false,
  );
});
