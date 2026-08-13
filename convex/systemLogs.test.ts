/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

describe("system log fingerprints", () => {
  test("groups matching Convex failures across unique request IDs", async () => {
    const t = setup();
    const firstRequestId = "90d75a486de1061e";
    const secondRequestId = "c9471a73c56b8cd8";
    const message = (requestId: string) =>
      `[CONVEX M(contact:submit)] [Request ID: ${requestId}] Server Error Called by client`;
    const fingerprint = (requestId: string) =>
      `client|ui|runtime_error|/contact|${message(requestId)}`;

    const first = await t.mutation(api.systemLogs.record, {
      message: message(firstRequestId),
      fingerprint: fingerprint(firstRequestId),
      path: "/contact",
    });
    const second = await t.mutation(api.systemLogs.record, {
      message: message(secondRequestId),
      fingerprint: fingerprint(secondRequestId),
      path: "/contact",
    });

    expect(first).toMatchObject({ logged: true, deduped: false });
    expect(second).toMatchObject({
      logged: true,
      deduped: true,
      id: first.id,
    });

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("systemLogs")
        .withIndex("by_createdAt")
        .take(10);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      occurrences: 2,
      fingerprint:
        "client|ui|runtime_error|/contact|[CONVEX M(contact:submit)] [Request ID] Server Error Called by client",
    });
  });

  test("canonicalizes generated fingerprints when clients omit one", async () => {
    const t = setup();
    const result = await t.mutation(api.systemLogs.record, {
      message:
        "[CONVEX Q(comments:list)] [Request ID: 92a77566bbbb3682] Server Error Called by client",
      path: "/portfolio/elizaos",
    });

    const stored = await t.run(async (ctx) => {
      return await ctx.db.get("systemLogs", result.id!);
    });
    expect(stored?.fingerprint).toBe(
      "client|application|runtime_error|/portfolio/elizaos|[CONVEX Q(comments:list)] [Request ID] Server Error Called by client",
    );
  });
});
