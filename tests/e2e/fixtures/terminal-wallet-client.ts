// Geometry-only capability fixture. No signer, transaction, or transport exists.
export * from "../../../lib/commerce-wallet-client";
import { supportsCommerceTransaction as actualSupports } from "../../../lib/commerce-wallet-client";

export function supportsCommerceTransaction(
  ...args: Parameters<typeof actualSupports>
) {
  return location.search.includes("orderquote")
    ? args[1] === 0
    : actualSupports(...args);
}
