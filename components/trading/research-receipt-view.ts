import type { ResearchState } from "@/lib/forum-research";

export type ReceiptFilter =
  "all" | "fulfilled" | "quoted" | "expired" | "rejected";
type Row = {
  intentKey: string;
  mint: string;
  state: ResearchState;
  expiresAt: number;
};
const protectedState = (state: ResearchState) =>
  state === "unknown" ||
  state === "verifying" ||
  state === "settlement_claimed";

/** Local projection only: never changes payment status, ownership or recovery. */
export function researchReceiptView<T extends Row>(
  rows: readonly T[],
  search: string,
  filter: ReceiptFilter,
  now: number,
) {
  const unique = new Map<string, T>();
  for (const row of rows) {
    const previous = unique.get(row.intentKey);
    if (
      !previous ||
      (!protectedState(previous.state) && protectedState(row.state))
    )
      unique.set(row.intentKey, row);
  }
  const term = search.trim();
  const matchesSearch = (row: T) =>
    !term ||
    row.mint.includes(term) ||
    row.intentKey.includes(term.toLowerCase());
  const pinned = [...unique.values()].filter((row) =>
    protectedState(row.state),
  );
  const matches = [...unique.values()].filter((row) => {
    if (protectedState(row.state) || !matchesSearch(row)) return false;
    const state =
      row.state === "quoted" && row.expiresAt <= now ? "expired" : row.state;
    return filter === "all" || state === filter;
  });
  return {
    pinned,
    matches,
    loaded: unique.size,
    pinnedSearchMatches: pinned.filter(matchesSearch).length,
    shown: pinned.length + matches.length,
  };
}
