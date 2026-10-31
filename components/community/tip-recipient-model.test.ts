import { expect, test } from "vitest";
import { filterTipRecipients } from "./tip-recipient-model";
test("trimmed public-handle search preserves original IDs, case, duplicate handles and wallets", () => {
  const rows = [
    { userId: "A", username: "Same", wallet: "WalletA" },
    { userId: "B", username: "Same", wallet: "walletB" },
    { userId: "C", username: "夜猫", wallet: "WalletC" },
  ];
  expect(filterTipRecipients(rows, "  @sAmE  ")).toEqual(rows.slice(0, 2));
  expect(filterTipRecipients(rows, "夜")).toEqual([rows[2]]);
  expect(filterTipRecipients(rows, "WalletA")).toEqual([]);
  expect(filterTipRecipients(rows, " ")).toBe(rows);
});
