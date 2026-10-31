const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 5,
});

/** Chart ticks only; never used for candles, quotes, balances or transaction math. */
export function formatChartAxisPrice(value: number, minMove: number): string {
  if (!Number.isFinite(value)) return "--";
  // Autoscaling can generate a negative epsilon at the zero gridline. Remove
  // only sub-tick roundoff; real micro-token prices retain their precision.
  const zero =
    Number.isFinite(minMove) && minMove > 0 && Math.abs(value) < minMove / 2;
  return usd.format(zero || Object.is(value, -0) ? 0 : value);
}
