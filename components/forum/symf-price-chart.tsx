"use client";

import { TokenPriceChart } from "@/components/trading/price-chart";
import { SYMF_TOKEN } from "@/lib/symf-token";

/** Preserve the token page and endpoint while sharing chart presentation. */
export function SymfPriceChart({ light }: { light: boolean }) {
  return (
    <TokenPriceChart
      mint={SYMF_TOKEN.mint}
      symbol={SYMF_TOKEN.symbol}
      light={light}
      endpoint="/api/token/symf/chart"
    />
  );
}
