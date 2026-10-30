import { expect, test } from "vitest";
import { RESEARCH_NETWORK } from "./forum-research";
import { researchRateWithinReserve } from "./forum-research-readiness";
test("only a current exact Solana rate within the reserved free credit amount can activate", () => {
  const now = Date.now(),
    entry = {
      network: RESEARCH_NETWORK,
      scheme: "exact",
      transferMethod: "svm_transfer",
      credits: "1.33",
      effectiveAt: new Date(now - 1000).toISOString(),
    };
  const provider = { pricing: { rates: [entry], upcoming: [] } };
  expect(researchRateWithinReserve(provider, now)).toBe(true);
  expect(
    researchRateWithinReserve(
      { pricing: { rates: [{ ...entry, credits: "2.01" }], upcoming: [] } },
      now,
    ),
  ).toBe(false);
  expect(
    researchRateWithinReserve(
      {
        pricing: {
          rates: [entry],
          upcoming: [
            {
              ...entry,
              credits: "3",
              effectiveAt: new Date(now + 30_000).toISOString(),
            },
          ],
        },
      },
      now,
    ),
  ).toBe(false);
  expect(
    researchRateWithinReserve(
      { pricing: { rates: [{ ...entry, credits: "NaN" }], upcoming: [] } },
      now,
    ),
  ).toBe(false);
  expect(
    researchRateWithinReserve(
      {
        pricing: {
          rates: [
            { ...entry, effectiveAt: new Date(now + 10_000).toISOString() },
          ],
          upcoming: [],
        },
      },
      now,
    ),
  ).toBe(false);
  expect(researchRateWithinReserve({}, now)).toBe(false);
});
