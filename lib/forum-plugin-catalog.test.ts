import { describe, expect, test } from "vitest";
import {
  FORUM_PLUGIN_OPERATIONS,
  FORUM_PLUGIN_TOOLS,
  findForumPluginTool,
  getForumPluginOperation,
  validateForumPluginArguments,
} from "./forum-plugin-catalog";
import {
  convexValidatorToJsonSchema,
  validateForumJsonSchema,
} from "./forum-plugin-schema";
import { forumOperationCapability } from "./forum-plugin-operation-policy";
import { v } from "convex/values";
import { queryGeneric } from "convex/server";

describe("shared forum operation catalog", () => {
  test("covers each forum surface without internal maintenance or toggle tools", () => {
    const operations = new Set(
      FORUM_PLUGIN_OPERATIONS.map((tool) => tool.operation),
    );
    for (const operation of [
      "listCategories",
      "search",
      "createThread",
      "createReply",
      "updatePollContent",
      "setThreadBookmark",
      "setThreadSubscription",
      "setCategorySubscription",
      "listPrivateMessages",
      "sendPrivateMessage",
      "votePoll",
      "rateThread",
      "setForumReputation",
      "listForumReports",
      "splitForumPosts",
      "upsertForumCategory",
      "updateUserForumRole",
    ])
      expect(operations.has(operation), operation).toBe(true);
    for (const operation of [
      "ensureDefaultForumCategories",
      "listPublicSitemapRecords",
      "routeStatus",
      "toggleThreadSubscription",
      "toggleCategorySubscription",
      "authorizeForumAttachmentUpload",
      "claimStoredForumAttachmentUpload",
    ])
      expect(operations.has(operation), operation).toBe(false);
    expect(new Set(FORUM_PLUGIN_OPERATIONS.map((tool) => tool.name)).size).toBe(
      FORUM_PLUGIN_OPERATIONS.length,
    );
  });
  test("only render tool opens the forum app; status and file inputs have dedicated metadata", () => {
    for (const tool of FORUM_PLUGIN_TOOLS)
      expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
    expect(
      FORUM_PLUGIN_TOOLS.filter((tool) => "ui" in tool._meta).map(
        (tool) => tool.name,
      ),
    ).toEqual(["forum_open"]);
    expect(
      FORUM_PLUGIN_TOOLS.find((tool) => tool.name === "forum_open")?._meta,
    ).toMatchObject({
      "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
    });
    expect(
      FORUM_PLUGIN_TOOLS.find((tool) => tool.name === "forum_status")?._meta,
    ).toMatchObject({ "openai/profile": true });
    expect(
      FORUM_PLUGIN_TOOLS.find(
        (tool) => tool.name === "forum_upload_attachments",
      )?._meta,
    ).toMatchObject({ "openai/fileParams": ["files"] });
  });
  test("strict typed arguments reject unknown fields, invalid unions and unsafe write retries", () => {
    const thread = findForumPluginTool("forum_create_thread")!;
    const valid = {
      categorySlug: "general",
      title: "A topic",
      body: "Some content",
      idempotencyKey: "command-1234",
      expectedPolicyVersion: 1,
    };
    expect(validateForumPluginArguments(thread, valid)).toBeNull();
    expect(
      validateForumPluginArguments(thread, { ...valid, ownerId: "forged" }),
    ).toContain("not allowed");
    expect(
      validateForumPluginArguments(thread, { ...valid, constructor: "forged" }),
    ).toContain("not allowed");
    expect(
      validateForumPluginArguments(
        thread,
        JSON.parse(JSON.stringify(valid).slice(0, -1) + ',"__proto__":{}}'),
      ),
    ).toContain("not allowed");
    expect(
      validateForumPluginArguments(thread, { ...valid, idempotencyKey: "x" }),
    ).toContain("invalid length");
    expect(
      validateForumPluginArguments(thread, {
        ...valid,
        poll: { question: "Choose", options: ["one"] },
      }),
    ).toContain("item count");
    expect(
      validateForumPluginArguments(thread, {
        ...valid,
        attachments: Array.from({ length: 6 }, () => ({
          storageId: "id",
          filename: "x.png",
        })),
      }),
    ).toContain("item count");
    expect(
      validateForumPluginArguments(thread, {
        ...valid,
        body: "x".repeat(64_001),
      }),
    ).toContain("invalid length");
    expect(
      validateForumPluginArguments(
        findForumPluginTool("forum_list_private_messages")!,
        { box: "anybody" },
      ),
    ).toContain("allowed value");
  });
  test("all mutations require an explicit valid acting-profile policy snapshot", () => {
    for (const tool of FORUM_PLUGIN_OPERATIONS.filter(
      (candidate) => !candidate.readOnly,
    )) {
      expect(tool.inputSchema.required, tool.name).toContain(
        "expectedPolicyVersion",
      );
      expect(tool.inputSchema.properties?.expectedPolicyVersion).toMatchObject({
        type: "integer",
        minimum: 1,
      });
    }
    const thread = findForumPluginTool("forum_create_thread")!;
    const args = {
      categorySlug: "general",
      title: "Title",
      body: "Body",
      idempotencyKey: "command-1234",
    };
    expect(validateForumPluginArguments(thread, args)).toContain(
      "expectedPolicyVersion is required",
    );
    for (const value of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])
      expect(
        validateForumPluginArguments(thread, {
          ...args,
          expectedPolicyVersion: value,
        }),
      ).not.toBeNull();
    expect(
      validateForumPluginArguments(thread, {
        ...args,
        expectedPolicyVersion: 1,
      }),
    ).toBeNull();
  });
  test("reflects public visibility, staff delegation and owner-only accounts", () => {
    expect(getForumPluginOperation("search")).toMatchObject({
      kind: "query",
      publicRead: true,
      capability: "read",
    });
    expect(getForumPluginOperation("listForumThreads")).toMatchObject({
      kind: "query",
      publicRead: false,
      capability: "moderate",
    });
    expect(getForumPluginOperation("listPrivateMessages")).toMatchObject({
      publicRead: false,
      capability: "messages",
    });
    expect(getForumPluginOperation("updateUserForumRole")).toMatchObject({
      kind: "mutation",
      capability: "accounts",
    });
    expect(forumOperationCapability("authorizeForumAttachmentUpload")).toBe(
      "attachments",
    );
    expect(forumOperationCapability("createPrivateMessageReport")).toBe(
      "feedback",
    );
    for (const tool of FORUM_PLUGIN_OPERATIONS.filter((tool) => !tool.readOnly))
      expect(tool.inputSchema.required).toContain("idempotencyKey");
  });
  test("converts nested Convex argument fields without permitting additional object properties", () => {
    const validator = v.object({
      value: v.union(v.null(), v.id("users")),
      nested: v.optional(v.array(v.object({ enabled: v.boolean() }))),
    });
    const registered = queryGeneric({
      args: validator.fields,
      handler: async () => null,
    });
    const schema = convexValidatorToJsonSchema(
      JSON.parse(
        (registered as unknown as { exportArgs(): string }).exportArgs(),
      ),
    );
    expect(
      validateForumJsonSchema(schema, {
        value: null,
        nested: [{ enabled: true }],
      }),
    ).toBeNull();
    expect(
      validateForumJsonSchema(schema, {
        value: "id",
        nested: [{ enabled: true, extra: 1 }],
      }),
    ).toContain("not allowed");
    expect(
      validateForumJsonSchema(schema, {
        value: "id",
        nested: [{ enabled: 1 }],
      }),
    ).toContain("boolean");
    expect(validateForumJsonSchema(schema, { nested: [] })).toContain(
      "required",
    );
  });
});
