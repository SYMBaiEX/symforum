/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const workflowMock = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue("workflow-id"),
}));

vi.mock("@convex-dev/workflow", () => ({
  WorkflowManager: class {
    constructor(_component: unknown, _options?: unknown) {}

    define() {
      return { handler: (handler: unknown) => handler };
    }

    start(...args: unknown[]) {
      return workflowMock.start(...args);
    }
  },
}));

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const setSourceStatus = makeFunctionReference<
  "mutation",
  { sourceId: Id<"evidenceSources">; status: "active" | "paused" },
  {
    sourceId: Id<"evidenceSources">;
    status: "active" | "paused";
    updatedAt: number;
  }
>("evidenceAdmin:setSourceStatus");

afterEach(() => {
  vi.unstubAllEnvs();
  workflowMock.start.mockClear();
});

async function seedAdminAndSource(visibility: "public" | "private") {
  const t = convexTest(schema, modules);
  const { adminId, sourceId } = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      name: "Evidence Admin",
      email: "evidence-admin@example.com",
      role: "admin",
    });
    const sourceId = await ctx.db.insert("evidenceSources", {
      sourceKey: `source-${visibility}`,
      name: "Evidence source",
      sourceType: "manual",
      ingestionEnabled: false,
      baseUrl: "https://example.com/",
      homepageUrl: "https://example.com/",
      status: "paused",
      licenseClass: "open",
      provenanceClass: "official",
      visibility,
      termsUrl: "https://example.com/terms",
      etag: "",
      lastModified: "",
      cursor: "",
      lastFetchedAt: 0,
      lastSucceededAt: 0,
      lastErrorAt: 0,
      lastErrorMessage: "",
      createdAt: 0,
      updatedAt: 0,
    });
    return { adminId, sourceId };
  });
  return { t, adminId, sourceId };
}

function enableAutomaticIndexing() {
  vi.stubEnv("SEMANTIC_SEARCH_ENABLED", "true");
  vi.stubEnv("SEMANTIC_SEARCH_AUTO_INDEX_ENABLED", "true");
  vi.stubEnv("SEMANTIC_SEARCH_DAILY_BUDGET_USD", "0.05");
  vi.stubEnv("OPENROUTER_API_KEY", "configured-test-key");
}

test("resuming a public source starts a source-scoped catch-up workflow", async () => {
  enableAutomaticIndexing();
  const { t, adminId, sourceId } = await seedAdminAndSource("public");

  await t
    .withIdentity({ subject: adminId, name: "Evidence Admin" })
    .mutation(setSourceStatus, { sourceId, status: "active" });

  expect(workflowMock.start).toHaveBeenCalledTimes(1);
  expect(workflowMock.start.mock.calls[0]?.[2]).toEqual({ sourceId });
  await expect(
    t.run((ctx) => ctx.db.get("evidenceSources", sourceId)),
  ).resolves.toMatchObject({ status: "active" });
});

test("resuming a private source does not enqueue semantic embedding work", async () => {
  enableAutomaticIndexing();
  const { t, adminId, sourceId } = await seedAdminAndSource("private");

  await t
    .withIdentity({ subject: adminId, name: "Evidence Admin" })
    .mutation(setSourceStatus, { sourceId, status: "active" });

  expect(workflowMock.start).not.toHaveBeenCalled();
});

test("pausing a public source queues vector cleanup without semantic-search credentials", async () => {
  const { t, adminId, sourceId } = await seedAdminAndSource("public");
  await t.run((ctx) =>
    ctx.db.patch("evidenceSources", sourceId, { status: "active" }),
  );

  await t
    .withIdentity({ subject: adminId, name: "Evidence Admin" })
    .mutation(setSourceStatus, { sourceId, status: "paused" });

  expect(workflowMock.start).toHaveBeenCalledTimes(1);
  expect(workflowMock.start.mock.calls[0]?.[2]).toEqual({ sourceId });
});
