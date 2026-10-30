import { expect, test } from "vitest";
import { refreshedQuoteNeedsReview } from "./swap-review";
const preview = {
  inputMint: "SOL",
  outputMint: "USDC",
  amountRaw: "10000000",
  minimumOutputAmountRaw: "900719925474099300000",
  platformFeeRaw: "25000",
  platformFeeBps: 25,
};
test("refresh accepts an unchanged or improved minimum using exact integers", () => {
  expect(refreshedQuoteNeedsReview(preview, { ...preview })).toBe(false);
  expect(
    refreshedQuoteNeedsReview(preview, {
      ...preview,
      minimumOutputAmountRaw: "900719925474099300001",
    }),
  ).toBe(false);
  expect(
    refreshedQuoteNeedsReview(preview, {
      ...preview,
      minimumOutputAmountRaw: "900719925474099299999",
    }),
  ).toBe(true);
});
test.each([
  { inputMint: "OTHER" },
  { outputMint: "OTHER" },
  { amountRaw: "10000001" },
  { platformFeeRaw: "25001" },
  { platformFeeBps: 0 },
])("refresh requires deliberate review for changed economics %j", (change) => {
  expect(refreshedQuoteNeedsReview(preview, { ...preview, ...change })).toBe(
    true,
  );
});
