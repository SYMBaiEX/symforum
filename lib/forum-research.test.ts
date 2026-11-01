import { describe, expect, test } from "vitest";
import {
  buildResearchReport,
  canonicalJson,
  exactResearchPayload,
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  RESEARCH_PRODUCT,
  researchHash,
  researchPaymentRequired,
  researchRequirements,
  researchResource,
} from "./forum-research";

const key = "a".repeat(64),
  feePayer = "So11111111111111111111111111111111111111112";
const source = {
  mint: feePayer,
  name: "Example",
  symbol: "EX",
  metricsAsOf: 100_000,
  generatedAt: 110_000,
  priceUsd: 0.01,
  marketCapUsd: 100_000,
  liquidityUsd: 10_000,
  volume1hUsd: 20_000,
  holders: 100,
  priceChange1hPercent: 5,
  sourceUrl: `https://pump.fun/coin/${feePayer}`,
  threadUrl: "https://forum.symbaiex.com/crypto-pumpfun/example",
};
describe("explicit research product contract", () => {
  test("quotes only exact $0.10 mainnet USDC with resource memo and v0", () => {
    const requirements = researchRequirements(key, feePayer);
    expect(requirements).toMatchObject({
      scheme: "exact",
      amount: "100000",
      asset: RESEARCH_ASSET,
      network: RESEARCH_NETWORK,
      extra: { transactionVersions: [0], memo: `symforum:research:${key}` },
    });
    expect(researchPaymentRequired(key, requirements)).toMatchObject({
      x402Version: 2,
      resource: { url: researchResource(key) },
      accepts: [requirements],
    });
  });
  test("resource, amount, asset, recipient, version and memo cannot be substituted", () => {
    const requirements = researchRequirements(key, feePayer),
      resource = researchResource(key);
    const payload = {
      x402Version: 2,
      resource: { url: resource },
      accepted: requirements,
      payload: { transaction: "AAAA" },
    };
    expect(exactResearchPayload(payload, requirements, resource)).toBe("AAAA");
    for (const changed of [
      { ...payload, x402Version: 1 },
      { ...payload, resource: { url: resource + "-other" } },
      { ...payload, accepted: { ...requirements, amount: "1" } },
      { ...payload, accepted: { ...requirements, asset: feePayer } },
      {
        ...payload,
        accepted: {
          ...requirements,
          extra: { ...requirements.extra, memo: "other" },
        },
      },
      { ...payload, extensions: {} },
      { ...payload, payload: { transaction: "AAAA", extra: "untrusted" } },
    ])
      expect(() =>
        exactResearchPayload(changed, requirements, resource),
      ).toThrow();
  });
  test("canonical hashing binds resource content but not object key ordering", async () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(await researchHash({ b: 2, a: 1 })).toBe(
      await researchHash({ a: 1, b: 2 }),
    );
    expect(await researchHash({ a: 2 })).not.toBe(await researchHash({ a: 1 }));
  });
  test("report freezes source times, keeps missing metrics unknown, distinguishes cap from FDV", () => {
    const report = buildResearchReport(source);
    expect(report.product).toBe(RESEARCH_PRODUCT);
    expect(report.analysis[0]).toContain("10.00%");
    expect(report.analysis[1]).toContain("20.00%");
    expect(report.facts[1].label).toContain("not FDV");
    expect(
      buildResearchReport({ ...source, marketCapUsd: null, holders: null })
        .facts[1].value,
    ).toBe("Unavailable");
    expect(
      buildResearchReport({ ...source, marketCapUsd: null }).analysis[0],
    ).toContain("cannot be calculated");
  });
  test.each([
    [1e-10, "$0.0000000001"],
    [1.234567890123456e-10, "$0.0000000001234567890123456"],
    [9.999999999e-9, "$0.000000009999999999"],
    [1e-8, "$0.00000001"],
    [Number.MIN_VALUE, `$0.${"0".repeat(323)}5`],
  ])("retains nonzero tiny report prices (%s)", (priceUsd, expected) => {
    const report = buildResearchReport({ ...source, priceUsd });
    expect(report.facts[0]).toEqual({ label: "Price (USD)", value: expected });
    expect(report.facts[0].value).not.toMatch(/[eE][+-]?\d/);
  });
  test("preserves tiny signed changes and non-price metric units", () => {
    const report = buildResearchReport({
      ...source,
      liquidityUsd: 1e-10,
      volume1hUsd: 2e-10,
      priceChange1hPercent: -1e-10,
    });
    expect(report.facts[2].value).toBe("$0.0000000001");
    expect(report.facts[3].value).toBe("$0.0000000002");
    expect(report.facts[5].value).toBe("-0.0000000001%");
  });
  test.each([0, -0])(
    "keeps actual zero distinct from tiny and missing (%s)",
    (zero) => {
      const report = buildResearchReport({
        ...source,
        priceUsd: zero,
        holders: zero,
        priceChange1hPercent: zero,
      });
      expect(report.facts[0].value).toBe("$0");
      expect(report.facts[4].value).toBe("0");
      expect(report.facts[5].value).toBe("0%");
    },
  );
  test.each([null, NaN, Infinity, -Infinity])(
    "keeps unavailable report metrics unknown (%s)",
    (missing) => {
      const report = buildResearchReport({
        ...source,
        priceUsd: missing,
        marketCapUsd: missing,
        liquidityUsd: missing,
        volume1hUsd: missing,
        holders: missing,
      });
      expect(report.facts.slice(0, 5).map((fact) => fact.value)).toEqual(
        Array(5).fill("Unavailable"),
      );
    },
  );
  test("keeps ordinary and large report formatting unchanged", () => {
    const report = buildResearchReport({
      ...source,
      priceUsd: 123.123456789,
      marketCapUsd: 1_520_000_000_000,
      holders: Number.MAX_SAFE_INTEGER,
    });
    expect(report.facts[0].value).toBe("$123.12345679");
    expect(report.facts[1].value).toBe("$1,520,000,000,000");
    expect(report.facts[4].value).toBe("9,007,199,254,740,991");
  });
  test("building a precise report does not mutate a frozen prior report or its hash", async () => {
    const input = Object.freeze({ ...source, priceUsd: 1e-10 });
    const prior = buildResearchReport(source);
    // Model a previously saved report: its recorded value is not reformatted.
    prior.facts[0].value = "$0";
    const savedJson = JSON.stringify(prior);
    const savedHash = await researchHash(prior);
    Object.freeze(prior.facts[0]);
    Object.freeze(prior.facts);
    Object.freeze(prior);

    const next = buildResearchReport(input);
    expect(next.facts[0].value).toBe("$0.0000000001");
    expect(JSON.stringify(prior)).toBe(savedJson);
    expect(await researchHash(prior)).toBe(savedHash);
    expect(next.generatedAt).toBe(source.generatedAt);
    expect(next.metricsAsOf).toBe(source.metricsAsOf);
    expect(next.sources).toEqual(prior.sources);
    expect(input.priceUsd).toBe(1e-10);
  });
  test("stale/future/malformed source data cannot create a payable report", () => {
    for (const changed of [
      { ...source, generatedAt: 4_000_001 },
      { ...source, metricsAsOf: 999_999 },
      { ...source, sourceUrl: "javascript:alert(1)" },
      { ...source, threadUrl: "https://name:pass@example.com" },
    ])
      expect(() => buildResearchReport(changed)).toThrow();
  });
});
