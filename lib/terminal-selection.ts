import { isSolanaAddress } from "./forum-commerce";

export type TerminalMintSelection =
  | { status: "default" }
  | { status: "invalid" }
  | { status: "valid"; mint: string };

/** URL identity only. This does not verify a mint or authorize a wallet trade. */
export function parseTerminalMint(
  values: readonly string[],
): TerminalMintSelection {
  if (values.length === 0) return { status: "default" };
  if (
    values.length !== 1 ||
    typeof values[0] !== "string" ||
    !isSolanaAddress(values[0])
  )
    return { status: "invalid" };
  return { status: "valid", mint: values[0] };
}

/** Preserve invalid intent too: never silently send a malformed link to SYMF. */
export function terminalRedirectForMint(
  value: string | string[] | undefined,
): string {
  const selection = parseTerminalMint(
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );
  return selection.status === "default"
    ? "/forum/trade"
    : `/forum/trade?mint=${encodeURIComponent(selection.status === "valid" ? selection.mint : "invalid")}`;
}
