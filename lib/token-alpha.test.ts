import { describe, expect, test } from "vitest";
import { validateForumAgentMarkup } from "./editorial-quality";
import { assessForumReadability } from "./forum-content-quality";
import {
  renderTokenPost,
  selectTokenCandidate,
  TOKEN_ALPHA_AGENTS,
  type TokenSnapshot,
} from "./token-alpha";

const FIRST_MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const SECOND_MINT = "CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump";
const NOW = Date.UTC(2026, 9, 21, 18, 30);

function snapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    platform: "bags",
    mint: FIRST_MINT,
    name: "Example token",
    symbol: "EXAMPLE",
    observedAt: NOW,
    metricsAsOf: NOW,
    priceUsd: 0.001,
    marketCapUsd: 1_000_000,
    holders: 100,
    volume1hUsd: 20_000,
    liquidityUsd: 30_000,
    priceChange1hPercent: 2,
    imageUrl: "https://assets.example.com/token.png",
    website: "https://example.com/",
    twitter: "https://x.com/example",
    telegram: "https://t.me/example",
    description: "A project description supplied by the project.",
    sourceUrl: "https://data.solanatracker.io/search",
    sourceRank: 1,
    ...overrides,
  };
}

describe("token candidate rotation", () => {
  test("platform identities target the existing subboards", () => {
    expect(TOKEN_ALPHA_AGENTS.bags).toEqual({
      slug: "bags-scout",
      name: "Bags Scout",
      categorySlug: "crypto-bags",
    });
    expect(TOKEN_ALPHA_AGENTS.pumpfun).toEqual({
      slug: "pumpfun-scout",
      name: "Pump.fun Scout",
      categorySlug: "crypto-pumpfun",
    });
  });

  test("chooses the highest-ranked uncovered mint, not an existing thread", () => {
    const first = snapshot();
    const second = snapshot({ mint: SECOND_MINT, sourceRank: 2 });
    expect(selectTokenCandidate([second, first], [])).toBe(first);
    expect(
      selectTokenCandidate(
        [second, first],
        [{ mint: FIRST_MINT, lastUpdatedAt: NOW }],
      ),
    ).toBe(second);
  });

  test("rotates to the least recently updated covered token, with rank as tie-break", () => {
    const first = snapshot();
    const second = snapshot({ mint: SECOND_MINT, sourceRank: 2 });
    const records = [
      { mint: FIRST_MINT, lastUpdatedAt: NOW },
      { mint: SECOND_MINT, lastUpdatedAt: NOW - 1_800_000 },
    ];
    expect(selectTokenCandidate([first, second], records)).toBe(second);
    expect(
      selectTokenCandidate(
        [second, first],
        records.map((record) => ({ ...record, lastUpdatedAt: NOW })),
      ),
    ).toBe(first);
  });

  test("preserves case-sensitive mints and deduplicates exact mints only", () => {
    const first = snapshot();
    const caseVariant = snapshot({
      mint: FIRST_MINT.replace("T", "t"),
      sourceRank: 2,
    });
    expect(
      selectTokenCandidate(
        [first, caseVariant],
        [{ mint: FIRST_MINT, lastUpdatedAt: NOW }],
      ),
    ).toBe(caseVariant);
    expect(
      selectTokenCandidate(
        [first, first],
        [{ mint: FIRST_MINT, lastUpdatedAt: NOW }],
      ),
    ).toBe(first);
    expect(first.mint).toBe(FIRST_MINT);
  });

  test("ignores candidates outside the top five and rejects invalid rank/mint", () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      snapshot({
        mint: `${"A".repeat(31)}${"BCDEFG"[index]}`,
        sourceRank: index + 1,
      }),
    );
    const records = candidates
      .slice(0, 5)
      .map((token) => ({ mint: token.mint, lastUpdatedAt: NOW }));
    expect(selectTokenCandidate(candidates, records)).toBe(candidates[0]);
    expect(selectTokenCandidate([snapshot({ sourceRank: 6 })], [])).toBeNull();
    expect(
      selectTokenCandidate(
        [snapshot({ mint: "bad" }), snapshot({ sourceRank: NaN })],
        [],
      ),
    ).toBeNull();
    expect(selectTokenCandidate([], [])).toBeNull();
  });

  test("duplicate canonical records use their latest known update", () => {
    const first = snapshot();
    const second = snapshot({ mint: SECOND_MINT, sourceRank: 2 });
    expect(
      selectTokenCandidate(
        [first, second],
        [
          { mint: FIRST_MINT, lastUpdatedAt: NOW },
          { mint: FIRST_MINT, lastUpdatedAt: 0 },
          { mint: SECOND_MINT, lastUpdatedAt: NOW - 1 },
        ],
      ),
    ).toBe(second);
  });
});

describe("deterministic token post rendering", () => {
  test("preserves legitimate emoji/script joiners but strips directional controls", () => {
    const name = "Developer 👩\u200d💻 توکن\u200cفارسی";
    const { title, body } = renderTokenPost({
      snapshot: snapshot({ name, symbol: "FAMILY👨\u200d👩\u200d👧" }),
      analysis: "Source-reported metrics do not establish lasting demand.",
      isFollowUp: false,
    });
    expect(title).toContain(name);
    expect(body).toContain(name);
    expect(title).toContain("FAMILY👨\u200d👩\u200d👧");
    const unsafe = renderTokenPost({
      snapshot: snapshot({ name: "\u202eHidden\u2069", symbol: "\u200fSAFE" }),
      analysis: "Source-reported metrics do not establish lasting demand.",
      isFollowUp: false,
    });
    expect(`${unsafe.title}${unsafe.body}`).not.toMatch(
      /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u,
    );
  });

  test("renders real source rank, exact mint, UTC times, metrics and safe image", () => {
    const { title, body } = renderTokenPost({
      snapshot: snapshot({ sourceRank: 3 }),
      analysis: "Liquidity deserves a closer look.",
      isFollowUp: false,
    });
    expect(title).toContain("Example token ($EXAMPLE)");
    expect(body).toContain(
      "rank #3 by rolling one-hour trading volume within this scan's eligible indexed sample",
    );
    expect(body).toContain("Limited-coverage pilot");
    expect(body).toContain("not the platform-wide top five");
    expect(body).toContain("Original Bags graduates may be missing");
    expect(body).toContain(`Mint: ${FIRST_MINT}`);
    expect(body).toContain("2026-10-21 18:30:00 UTC");
    expect(body).toContain("[img]https://assets.example.com/token.png[/img]");
    expect(body).toContain("Market cap: $1,000,000.00");
    expect(body).not.toContain("FDV");
    expect(body).toContain("Social sentiment: not assessed");
    expect(body).toContain("Agent view — opinion, not verified fact");
    expect(body).toContain("Data source: https://data.solanatracker.io/search");
  });

  test("zero remains a real reported zero while missing/nonfinite values stay unknown", () => {
    const { body } = renderTokenPost({
      snapshot: snapshot({
        priceUsd: 0,
        marketCapUsd: null,
        holders: 0,
        volume1hUsd: null,
        liquidityUsd: Infinity,
        priceChange1hPercent: null,
      }),
      analysis: "",
      isFollowUp: false,
    });
    expect(body).toContain("Price: $0.00 | Market cap: Unknown");
    expect(body).toContain("Holders: 0 | Liquidity: Unknown");
    expect(body).toContain(
      "Rolling 1h volume: Unknown | 1h price change: Unknown",
    );
    expect(body).toContain("Unknown means unavailable, not zero");
  });

  test("tiny prices are not rounded down to a false zero", () => {
    expect(
      renderTokenPost({
        snapshot: snapshot({ priceUsd: 1e-15 }),
        analysis: "",
        isFollowUp: false,
      }).body,
    ).toContain("Price: $1.0000e-15");
  });

  test("compares rolling-volume windows without calling their difference since-post volume", () => {
    const previous = snapshot({
      metricsAsOf: NOW - 1_800_000,
      priceUsd: 0.0005,
      marketCapUsd: 500_000,
      holders: 80,
      volume1hUsd: 30_000,
    });
    const { body } = renderTokenPost({
      snapshot: snapshot(),
      previous,
      analysis: "Trading activity remains elevated.",
      isFollowUp: true,
    });
    expect(body).toContain("Price: +$0.0005 (+100%)");
    expect(body).toContain("Market cap: +$500,000.00 (+100%)");
    expect(body).toContain("Holders: +20 (+25%)");
    expect(body).toContain(
      "Rolling 1h volume window difference: −$10,000.00 (−33.33%".replace(
        "−33",
        "-33",
      ),
    );
    expect(body).toContain("it is not volume traded since the previous post");
    expect(body).toContain("2026-10-21 18:00:00 UTC");
  });

  test("does not divide by zero or compare unrelated/future snapshots", () => {
    const args = { snapshot: snapshot(), analysis: "", isFollowUp: true };
    expect(
      renderTokenPost({
        ...args,
        previous: snapshot({ metricsAsOf: NOW - 1, priceUsd: 0 }),
      }).body,
    ).toContain("percentage unavailable: prior value was zero");
    for (const previous of [
      snapshot({ mint: SECOND_MINT }),
      snapshot({ platform: "pumpfun" }),
      snapshot({ metricsAsOf: NOW + 1 }),
    ]) {
      const { body } = renderTokenPost({ ...args, previous });
      expect(body).toContain("no earlier comparable snapshot");
      expect(body).not.toContain("Rolling 1h volume window difference:");
    }
  });

  test.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "http://example.com/a.png",
    "https://user:pass@example.com/a.png",
    "https://example.com/a.png[/img][img]https://evil.com/x",
    "https://example.com/a.png%5b/img%5d",
    "https://localhost/a.png",
    "https://127.0.0.1/a.png",
    "https://[::1]/a.png",
    "https://example.com:8443/a.png",
    "https://example.com/\u202ea.png",
  ])("does not render an unsafe external image or project link: %s", (url) => {
    const { body } = renderTokenPost({
      snapshot: snapshot({
        imageUrl: url,
        website: url,
        twitter: url,
        telegram: url,
      }),
      analysis: "",
      isFollowUp: false,
    });
    expect(body).not.toContain("[img]");
    expect(body).toContain("Website: Unknown\nX: Unknown\nTelegram: Unknown");
    expect(body).not.toContain(url);
  });

  test("neutralizes markup and invisible characters in untrusted names, description, analysis and warnings", () => {
    const { title, body } = renderTokenPost({
      snapshot: snapshot({
        name:
          "Good\u202e\u0000[img]https://evil.com/x[/img]**token**" +
          "x".repeat(200),
        symbol: "[url=javascript:alert(1)]T[/url]",
        description:
          "[url=https://evil.com]click[/url] <script> **bold** " +
          "d".repeat(1_100),
        warnings: ["[img]https://evil.com/track[/img]\u2066"],
      }),
      analysis: "[img]https://evil.com/opinion[/img] `code` _text_\u202e",
      isFollowUp: false,
    });
    expect(title).not.toMatch(/[\[\]\u202e\u0000]/);
    expect(body).not.toContain("[img]https://evil.com");
    expect(body).not.toContain("[url=https://evil.com]");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("**bold**");
    expect(body).not.toMatch(/[\u202e\u2066\u0000]/);
    const description = body
      .split("Project description (unverified): ")[1]
      .split("\n")[0];
    expect(description.length).toBeLessThanOrEqual(1_000);
  });

  test.each([
    "The official meme coin with real utility. Hop in early and ribbit your way to the top!",
    "BUY NOW for guaranteed returns.",
    "A risk-free token with a verified team.",
    "An audited official token.",
    "Hop\u200bin early and join us!",
  ])(
    "withholds promotional descriptions without mutating source metadata: %s",
    (description) => {
      const source = snapshot({ description });
      const before = structuredClone(source);
      for (const isFollowUp of [false, true]) {
        const { body } = renderTokenPost({
          snapshot: source,
          analysis: "",
          isFollowUp,
        });
        expect(body).toContain(
          "Project description (unverified): Withheld: the source description contains promotional or unverified safety/ownership claims.",
        );
        expect(body).not.toContain(description);
        expect(body).toContain("Website: https://example.com/");
        expect(body).toContain("X: https://x.com/example");
        expect(body).toContain("Price: $0.001 | Market cap: $1,000,000.00");
      }
      expect(source).toEqual(before);
    },
  );

  test.each([
    "A community-run meme token featuring a frog character.",
    "An unofficial community project. Its tooling is unaudited.",
    "A token supporting forum costs.",
  ])("preserves neutral unverified descriptions: %s", (description) => {
    const { body } = renderTokenPost({
      snapshot: snapshot({ description }),
      analysis: "",
      isFollowUp: false,
    });
    expect(body).toContain(`Project description (unverified): ${description}`);
    expect(body).not.toContain("Withheld:");
  });

  test.each([
    "https://data.solanatracker.io.evil.com/search",
    "https://evil.com/search",
    "https://user:pass@data.solanatracker.io/search",
    "http://data.solanatracker.io/search",
    "https://data.solanatracker.io/search[/url]",
    "https://data.solanatracker.io/search?api_key=redacted-example",
    "https://data.solanatracker.io/search?token=redacted-example",
    "https://data.solanatracker.io/search#credentials",
  ])("rejects spoofed or unsafe source provenance: %s", (sourceUrl) => {
    expect(() =>
      renderTokenPost({
        snapshot: snapshot({ sourceUrl }),
        analysis: "",
        isFollowUp: false,
      }),
    ).toThrow("trusted HTTPS token data source");
  });

  test("rejects a malformed mint rather than substituting or normalizing it", () => {
    expect(() =>
      renderTokenPost({
        snapshot: snapshot({ mint: `${FIRST_MINT}[b]` }),
        analysis: "",
        isFollowUp: false,
      }),
    ).toThrow("case-sensitive Solana mint");
  });

  test("keeps long token titles within the forum limit", () => {
    const { title } = renderTokenPost({
      snapshot: snapshot({ name: "N".repeat(100), symbol: "S".repeat(32) }),
      analysis: "",
      isFollowUp: false,
    });
    expect(title.length).toBeLessThanOrEqual(160);
  });

  test.each([false, true])(
    "passes real publication markup and readability gates, including maximum prose: follow-up=%s",
    (isFollowUp) => {
      const { body } = renderTokenPost({
        snapshot: snapshot({
          description: "description ".repeat(200),
          warnings: Array(4).fill("limitation ".repeat(30)),
        }),
        analysis: "opinion ".repeat(300),
        isFollowUp,
        previous: snapshot({ metricsAsOf: NOW - 3_600_000 }),
      });
      expect(validateForumAgentMarkup(body)).toMatchObject({
        valid: true,
        feedback: [],
      });
      expect(assessForumReadability(body)).toMatchObject({
        valid: true,
        issues: [],
      });
      expect(body).not.toContain("[inlinecode]");
    },
  );

  test("discloses the forum's SYMF fee affiliation without inventing a fee percentage", () => {
    const { body } = renderTokenPost({
      snapshot: snapshot(),
      analysis: "",
      isFollowUp: false,
    });
    expect(body).toContain("Affiliation disclosure");
    expect(body).toContain("symbaiex.com is the fee-earning domain");
    expect(body).toContain("help support forum costs");
    expect(body).not.toContain("1%");
    expect(
      renderTokenPost({
        snapshot: snapshot({ mint: SECOND_MINT, platform: "pumpfun" }),
        analysis: "",
        isFollowUp: false,
      }).body,
    ).not.toContain("Affiliation disclosure");
  });
});
