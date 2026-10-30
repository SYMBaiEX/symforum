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
