import { describe, expect, test } from "vitest";
import {
  directoryState,
  requestDirectoryPage,
  receiveDirectoryPage,
  failDirectoryPage,
  mergeDirectoryRows,
  directoryPageIdentity,
} from "./project-directory-model";
const row = (projectId: string) => ({ projectId });
const first = { page: [row("a")], continueCursor: "one", isDone: false };
describe("explicit project cursor state", () => {
  test("manual live reset clears snapshots and invalidates pending outcomes without changing scope", () => {
    const old = requestDirectoryPage(
      directoryState("exact-mint/current-owner", first),
    );
    const reset = directoryState(old.scope, first, old.generation + 1);
    expect(reset.rows).toEqual([]);
    expect(reset.scope).toBe(old.scope);
    expect(reset.cursor).toBe(first.continueCursor);
    expect(
      receiveDirectoryPage(reset, old.pending!, {
        page: [row("stale")],
        continueCursor: "done",
        isDone: true,
      }),
    ).toBe(reset);
    expect(failDirectoryPage(reset, old.pending!)).toBe(reset);
  });
  test("first-page identity changes invalidate the chain, but stable public content edits do not", () => {
    const state = directoryState("all", first);
    expect(
      directoryPageIdentity({
        ...first,
        page: [{ ...first.page[0], name: "Changed public name" }],
      }),
    ).toBe(state.seedIdentity);
    expect(
      directoryPageIdentity({ ...first, page: [row("replacement")] }),
    ).not.toBe(state.seedIdentity);
    expect(directoryPageIdentity({ ...first, continueCursor: "new" })).not.toBe(
      state.seedIdentity,
    );
    expect(directoryPageIdentity({ ...first, isDone: true })).not.toBe(
      state.seedIdentity,
    );
  });
  test("requests once, deduplicates and marks exhaustion only from backend", () => {
    let state = requestDirectoryPage(directoryState("all", first));
    expect(requestDirectoryPage(state)).toBe(state);
    state = receiveDirectoryPage(state, state.pending!, {
      page: [row("a"), row("b")],
      continueCursor: "end",
      isDone: true,
    });
    expect(mergeDirectoryRows(first.page, state.rows)).toEqual([
      row("a"),
      row("b"),
    ]);
    expect(state.isDone).toBe(true);
    expect(requestDirectoryPage(state)).toBe(state);
  });
  test("empty partial pages do not exhaust and no automatic drain occurs", () => {
    let state = requestDirectoryPage(directoryState("all", first));
    state = receiveDirectoryPage(state, state.pending!, {
      page: [],
      continueCursor: "two",
      isDone: false,
    });
    expect(state.isDone).toBe(false);
    expect(state.pending).toBeNull();
    expect(state.cursor).toBe("two");
  });
  test("old generations, request ids and cursor responses cannot cross owner/mint ABA", () => {
    const old = requestDirectoryPage(directoryState("mintA/ownerA", first));
    const next = requestDirectoryPage(directoryState("mintA/ownerA", first, 2));
    expect(
      receiveDirectoryPage(next, old.pending!, {
        page: [row("stale")],
        continueCursor: "end",
        isDone: true,
      }),
    ).toBe(next);
    expect(failDirectoryPage(next, old.pending!)).toBe(next);
    expect(
      receiveDirectoryPage(next, { ...next.pending!, cursor: "wrong" }, first),
    ).toBe(next);
    expect(failDirectoryPage(next, { ...next.pending!, requestId: 99 })).toBe(
      next,
    );
  });
  test("retry preserves rows/cursor and invalidates the failed request", () => {
    let state = requestDirectoryPage(directoryState("all", first));
    const failed = state.pending!;
    state = failDirectoryPage(state, failed);
    expect(state.cursor).toBe("one");
    state = requestDirectoryPage(state);
    expect(state.pending?.requestId).not.toBe(failed.requestId);
    expect(failDirectoryPage(state, failed)).toBe(state);
  });
  test.each(["SplitRequired", "SplitRecommended"] as const)(
    "%s never appends an incomplete range or advances, smaller retry is explicit",
    (pageStatus) => {
      let state = requestDirectoryPage(directoryState("all", first));
      state = receiveDirectoryPage(state, state.pending!, {
        page: [row("incomplete")],
        continueCursor: "unsafe",
        isDone: true,
        pageStatus,
        splitCursor: "split",
      });
      expect(state.rows).toEqual([]);
      expect(state.cursor).toBe("one");
      expect(state.isDone).toBe(false);
      expect(state.pending).toBeNull();
      state = requestDirectoryPage(state);
      expect(state.pending?.cursor).toBe("one");
      expect(state.pageSize).toBe(6);
    },
  );
  test("initial split retries from null, and repeated cursors fail honestly", () => {
    let state = directoryState("all", {
      ...first,
      pageStatus: "SplitRequired",
    });
    state = requestDirectoryPage(state);
    expect(state.pending?.cursor).toBeNull();
    expect(state.pageSize).toBe(6);
    state = receiveDirectoryPage(state, state.pending!, {
      page: [],
      continueCursor: "two",
      isDone: false,
    });
    state = requestDirectoryPage(state);
    state = receiveDirectoryPage(state, state.pending!, {
      page: [],
      continueCursor: "two",
      isDone: false,
    });
    expect(state.blocked).toBe(true);
    expect(state.isDone).toBe(false);
    expect(requestDirectoryPage(state)).toBe(state);
    expect(state.error).toMatch(/did not advance/);
  });
  test("even a one-item split stops honestly instead of suggesting unavailable smaller reads", () => {
    let state = directoryState("all", first);
    for (let i = 0; i < 5; i++) {
      state = requestDirectoryPage(state);
      if (!state.pending) break;
      state = receiveDirectoryPage(state, state.pending, {
        ...first,
        pageStatus: "SplitRequired",
      });
    }
    expect(state.pageSize).toBe(1);
    expect(state.isDone).toBe(false);
    expect(state.error).toContain("still exceeds");
    expect(requestDirectoryPage(state)).toBe(state);
  });
});
