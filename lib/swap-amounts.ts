/** Exact decimal input, never binary-float conversion of token base units. */
export function normalizeTokenAmount(value: string): string {
  return /^\.\d/.test(value) ? `0${value}` : value;
}
export function parseTokenAmount(value: string, decimals: number): string {
  value = normalizeTokenAmount(value);
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]*)?$/.test(value)
  )
    throw new Error("Enter a valid positive amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  const n =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (n <= 0n || n > 18_446_744_073_709_551_615n)
    throw new Error("Amount is out of range.");
  return n.toString();
}
export function formatTokenAmount(raw: string, decimals: number): string {
  const n = BigInt(raw),
    scale = 10n ** BigInt(decimals);
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${(n / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
