/** Offline schema extraction only; never executes registered function handlers. */
import * as forum from "../convex/forum";
import * as admin from "../convex/admin";
import { forumPluginUiOperations } from "../convex/forumPluginUiOperations";
import { v } from "convex/values";
import {
  convexValidatorToJsonSchema,
  type ForumJsonSchema,
} from "../lib/forum-plugin-schema";
import { writeFileSync } from "node:fs";

const excluded = new Set([
  "routeStatus",
  "getForumExperienceMetrics",
  "feedAuthorizationFingerprint",
  "listPublicSitemapRecords",
  "ensureDefaultForumCategories",
  "toggleThreadSubscription",
  "toggleCategorySubscription",
]);
const accounts = new Set([
  "listUsers",
  "updateUserForumRole",
  "updateUserForumTrust",
  "updateUserForumStatus",
]);
type Registered = {
  isPublic?: boolean;
  isQuery?: boolean;
  isMutation?: boolean;
  exportArgs?: () => string;
};
const entries: Record<
  string,
  { kind: "query" | "mutation"; schema: ForumJsonSchema }
> = {};
for (const [operation, candidate] of [
  ...Object.entries(forum),
  ...Object.entries(admin).filter(([name]) => accounts.has(name)),
]) {
  const definition = candidate as Registered;
  if (excluded.has(operation) || !definition.isPublic || !definition.exportArgs)
    continue;
  if (!definition.isQuery && !definition.isMutation) continue;
  entries[operation] = {
    kind: definition.isQuery ? "query" : "mutation",
    schema: convexValidatorToJsonSchema(JSON.parse(definition.exportArgs())),
  };
}
for (const [operation, entry] of Object.entries(forumPluginUiOperations)) {
  entries[operation] = {kind: entry.kind, schema: convexValidatorToJsonSchema((v.object(entry.definition.args) as unknown as { json: Parameters<typeof convexValidatorToJsonSchema>[0] }).json)};
}
for (const operation of ["setThreadSubscription", "setCategorySubscription"]) {
  if (!entries[operation])
    entries[operation] = {
      kind: "mutation",
      schema: {
        type: "object",
        properties: {
          [operation === "setThreadSubscription" ? "threadId" : "categoryId"]: {
            type: "string",
            minLength: 1,
          },
          subscribed: { type: "boolean" },
        },
        required: [
          operation === "setThreadSubscription" ? "threadId" : "categoryId",
          "subscribed",
        ],
        additionalProperties: false,
      },
    };
}
const serialized = `${JSON.stringify(entries, null, 2)}\n`;
const destination = new URL(
  "../lib/forum-plugin-catalog.generated.json",
  import.meta.url,
);
if (process.argv.includes("--check")) {
  const { readFileSync } = await import("node:fs");
  if (readFileSync(destination, "utf8") !== serialized)
    throw new Error(
      "Forum plugin catalog is stale. Run bun scripts/generate-forum-plugin-catalog.ts",
    );
} else writeFileSync(destination, serialized);
