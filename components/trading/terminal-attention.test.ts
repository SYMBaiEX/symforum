import { describe, expect, it } from "vitest";
import {
  terminalAttentionReducer as reduce,
  terminalAttentionSnapshot as snapshot,
} from "./terminal-attention";

describe("terminal protected-operation presentation", () => {
  it("reports known counts in stable order without suggesting an all-clear state", () => {
    let reports = reduce({}, { id: "research", target: "research", count: 2 });
    reports = reduce(reports, { id: "swap", target: "receipts", count: 1 });
    expect(snapshot(reports)).toEqual([
      { target: "receipts", count: 1 },
      { target: "research", count: 2 },
    ]);
    expect(snapshot({})).toEqual([]);
  });

  it("does not double count a history and a live receipt for the same category", () => {
    let reports = reduce({}, { id: "history", target: "community", count: 3 });
    reports = reduce(reports, { id: "dialog", target: "community", count: 1 });
    expect(snapshot(reports)).toEqual([{ target: "community", count: 3 }]);
    reports = reduce(reports, { id: "history", target: "community", count: 0 });
    expect(snapshot(reports)).toEqual([{ target: "community", count: 1 }]);
  });

  it("clears only the unmounted or signed-out owner and retains other sources", () => {
    let reports = reduce({}, { id: "swap", target: "receipts", count: 1 });
    reports = reduce(reports, { id: "research", target: "research", count: 2 });
    reports = reduce(reports, { id: "swap", target: "receipts", count: 0 });
    expect(snapshot(reports)).toEqual([{ target: "research", count: 2 }]);
    reports = reduce(reports, { id: "research", target: "research", count: 0 });
    expect(snapshot(reports)).toEqual([]);
  });

  it("ignores invalid counts and preserves state for repeated reports", () => {
    const reports = reduce({}, { id: "swap", target: "receipts", count: 1 });
    expect(reduce(reports, { id: "swap", target: "receipts", count: 1 })).toBe(
      reports,
    );
    expect(
      reduce(reports, { id: "unknown", target: "receipts", count: -1 }),
    ).toBe(reports);
    expect(
      reduce(reports, { id: "unknown", target: "receipts", count: NaN }),
    ).toBe(reports);
    expect(
      reduce(reports, { id: "swap", target: "receipts", count: Infinity }),
    ).toEqual({});
  });
});
