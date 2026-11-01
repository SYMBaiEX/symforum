/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { getBase58Decoder } from "@solana/kit";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  directoryState,
  requestDirectoryPage,
  receiveDirectoryPage,
  mergeDirectoryRows,
} from "../components/community/project-directory-model";
const modules = import.meta.glob("./**/*.ts");
const opts = {
  numItems: 24,
  maximumRowsRead: 24,
  maximumBytesRead: 262144,
  cursor: null,
};
const mint = (n: number) =>
  getBase58Decoder().decode(new Uint8Array(32).fill(n));
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const t = convexTest(schema, modules);
  const fetch = vi.fn(() => {
    throw new Error("Providers denied");
  });
  vi.stubGlobal("fetch", fetch);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      username: "public-builder",
      email: "private@example.test",
    });
    for (let i = 0; i < 53; i++) {
      const projectId = await ctx.db.insert("forumCommunityProjects", {
        mint: mint(i + 1),
        name: `Public project ${i}`,
        symbol: `P${i}`,
        createdAt: i,
        updatedAt: Math.floor(i / 2),
      });
      for (let j = 0; j < (i === 52 ? 14 : 1); j++) {
        const claimUserId = j ? await ctx.db.insert("users", {}) : userId;
        await ctx.db.insert("forumCommunityProjectClaims", {
          projectId,
          userId: claimUserId,
          wallet: mint(80),
          role: "Self-declared contributor",
          description: "Public project affiliation",
          website: null,
          updatedAt: j,
        });
      }
    }
  });
  return { t, fetch };
}
describe("bounded public project pages", () => {
  test("explicit cursors reach all 53 projects beyond the old window, preserving exact public projection", async () => {
    const { t, fetch } = await setup();
    const original = await t.query(api.forumCommunity.listProjects, {});
    const first = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: opts,
    });
    expect(first.page).toEqual(original);
    expect(first.page[0].claims).toHaveLength(12);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: { ...opts, cursor: first.continueCursor },
    });
    const third = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: { ...opts, cursor: second.continueCursor },
    });
    const rows = [...first.page, ...second.page, ...third.page];
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map((row) => row.projectId)).size).toBe(53);
    expect(third.isDone).toBe(true);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "claims",
        "mint",
        "name",
        "projectId",
        "symbol",
      ]);
      for (const claim of row.claims) {
        expect(Object.keys(claim).sort()).toEqual([
          "description",
          "role",
          "updatedAt",
          "userId",
          "username",
          "website",
        ]);
        expect(claim).not.toHaveProperty("wallet");
        expect(claim).not.toHaveProperty("email");
        expect(claim).not.toHaveProperty("verified");
      }
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await t.run((ctx) => ctx.db.query("forumCommunityPayments").take(1)),
    ).toEqual([]);
  });
  test("mint scope matches the old public projection without mixing cursors or case", async () => {
    const { t } = await setup();
    const exact = mint(20);
    const page = await t.query(api.forumCommunity.listProjectPage, {
      mint: exact,
      paginationOpts: opts,
    });
    expect(page.page).toEqual(
      await t.query(api.forumCommunity.listProjects, { mint: exact }),
    );
    expect(page.page).toHaveLength(1);
    expect(page.page[0].mint).toBe(exact);
    expect(page.isDone).toBe(true);
    await expect(
      t.query(api.forumCommunity.listProjectPage, {
        mint: "not-a-mint",
        paginationOpts: opts,
      }),
    ).rejects.toThrow("exact Solana mint");
  });
  test("real split metadata reaches the model and only explicit smaller reads traverse the directory without gaps", async () => {
    const { t } = await setup();
    const first = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: opts,
    });
    expect(first.pageStatus).toBe("SplitRequired");
    expect(first.splitCursor).toEqual(expect.any(String));
    let state = directoryState("all", first);
    expect(state.blocked).toBe(true);
    expect(state.cursor).toBeNull();
    let clicks = 0;
    while (!state.isDone && clicks < 10) {
      state = requestDirectoryPage(state);
      const request = state.pending!;
      expect(request).not.toBeNull();
      const page = await t.query(api.forumCommunity.listProjectPage, {
        paginationOpts: {
          ...opts,
          numItems: state.pageSize,
          cursor: request.cursor,
        },
      });
      state = receiveDirectoryPage(state, request, page);
      expect(state.pending).toBeNull();
      clicks++;
    }
    const rows = mergeDirectoryRows(first.page, state.rows);
    expect(state.isDone).toBe(true);
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map((row) => row.projectId)).size).toBe(53);
    expect(clicks).toBe(9);
    const byteLimited = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: { ...opts, maximumBytesRead: 1 },
    });
    expect(byteLimited.pageStatus).toBe("SplitRequired");
    expect(byteLimited.page).toHaveLength(1);
  });
  test("default12 pages traverse all53 through backend and UI state without routine splits or handshake reads", async () => {
    const { t, fetch } = await setup();
    const defaults = { ...opts, numItems: 12 };
    const first = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: defaults,
    });
    expect(first.page).toHaveLength(12);
    expect(first.pageStatus).toBeNull();
    let state = directoryState("all", first);
    let clicks = 0;
    while (!state.isDone && clicks < 10) {
      expect(state.blocked).toBe(false);
      state = requestDirectoryPage(state);
      const request = state.pending!;
      const page = await t.query(api.forumCommunity.listProjectPage, {
        paginationOpts: { ...defaults, cursor: request.cursor },
      });
      expect(page.pageStatus).toBeNull();
      state = receiveDirectoryPage(state, request, page);
      expect(state.pending).toBeNull();
      clicks++;
    }
    expect(state.isDone).toBe(true);
    expect(clicks).toBe(4);
    expect(mergeDirectoryRows(first.page, state.rows)).toHaveLength(53);
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    { numItems: 25 },
    { numItems: 0 },
    { numItems: 1.5 },
    { numItems: NaN },
    { numItems: Infinity },
    { maximumRowsRead: undefined },
    { maximumRowsRead: 25 },
    { maximumRowsRead: -1 },
    { maximumRowsRead: 1.5 },
    { maximumRowsRead: Infinity },
    { maximumBytesRead: undefined },
    { maximumBytesRead: 262145 },
    { maximumBytesRead: 0 },
    { maximumBytesRead: 1.5 },
    { maximumBytesRead: NaN },
    { id: NaN },
    { id: -1 },
    { id: 1.5 },
    { cursor: "x".repeat(16385) },
    { endCursor: "x".repeat(16385) },
  ])("rejects unsafe page options %j", async (invalid) => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.forumCommunity.listProjectPage, {
        paginationOpts: { ...opts, ...invalid },
      }),
    ).rejects.toThrow();
  });
  test("native id/endCursor remain accepted and malformed opaque cursors fail without effects", async () => {
    const { t, fetch } = await setup();
    const first = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: opts,
    });
    const bounded = await t.query(api.forumCommunity.listProjectPage, {
      paginationOpts: { ...opts, id: 7, endCursor: first.continueCursor },
    });
    expect(bounded.page).toEqual(first.page);
    await expect(
      t.query(api.forumCommunity.listProjectPage, {
        paginationOpts: { ...opts, cursor: "invented-invalid-cursor" },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
