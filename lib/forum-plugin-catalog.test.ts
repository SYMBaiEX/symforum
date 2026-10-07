import { describe, expect, test } from "vitest";
import {
  FORUM_PLUGIN_OPERATIONS,
  FORUM_PLUGIN_TOOLS,
  FORUM_PLUGIN_ICON,
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
import generated from "./forum-plugin-catalog.generated.json";

describe("shared forum operation catalog", () => {
  test("private-message reporting declares the irreversible staff disclosure and recipient boundary", () => {
    const tool = findForumPluginTool("forum_create_private_message_report")!;
    expect(tool).toMatchObject({
      capability: "feedback",
      publicRead: false,
      readOnly: false,
      destructive: true,
      openWorld: false,
    });
    expect(
      FORUM_PLUGIN_TOOLS.find((candidate) => candidate.name === tool.name)
        ?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
      idempotentHint: true,
    });
    expect(tool.description).toContain("subject, body and sender identity");
    expect(tool.description).toContain("cannot be undone");
    const valid = {
      messageId: "received-message",
      reason: "Abuse",
      details: "x".repeat(1_000),
      idempotencyKey: "report-retry-123",
      expectedPolicyVersion: 1,
    };
    expect(validateForumPluginArguments(tool, valid)).toBeNull();
    for (const changed of [
      { reason: "xx" },
      { reason: "x".repeat(81) },
      { details: "x".repeat(1_001) },
      { recipientUserId: "another-user" },
      { snapshotBody: "forged message" },
    ])
      expect(
        validateForumPluginArguments(tool, { ...valid, ...changed }),
      ).not.toBeNull();
    expect(
      validateForumPluginArguments(tool, {
        messageId: "received-message",
        reason: "Abuse",
      }),
    ).not.toBeNull();
  });
  test("stored news is a bounded public read and validates edition shape before dispatch", () => {
    const tool = findForumPluginTool("forum_list_news_feed")!;
    expect(tool).toMatchObject({
      capability: "read",
      publicRead: true,
      readOnly: true,
      destructive: false,
      openWorld: true,
    });
    expect(validateForumPluginArguments(tool, {})).toBeNull();
    expect(
      validateForumPluginArguments(tool, {
        snapshotDate: "2026-10-02",
        limit: 30,
      }),
    ).toBeNull();
    for (const invalid of [
      { snapshotDate: "2026/10/02" },
      { snapshotDate: "abcdefghij" },
      { limit: 0 },
      { limit: 31 },
      { limit: 1.5 },
      { refresh: true },
    ])
      expect(validateForumPluginArguments(tool, invalid)).not.toBeNull();
  });
  test("all 128 tools explicitly classify reads, destructive writes and public audiences", () => {
    expect(FORUM_PLUGIN_TOOLS).toHaveLength(128);
    for (const tool of FORUM_PLUGIN_TOOLS) {
      for (const name of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const)
        expect(typeof tool.annotations[name], `${tool.name} ${name}`).toBe("boolean");
      const operation = findForumPluginTool(tool.name)!;
      const domain = generated[operation.operation as keyof typeof generated];
      if (domain) expect(tool.annotations.readOnlyHint, tool.name).toBe(domain.kind === "query");
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
    const hints = (name: string) => FORUM_PLUGIN_TOOLS.find(tool => tool.name === name)!.annotations;
    for (const name of ["forum_search", "forum_get_thread", "forum_list_news_feed", "forum_create_thread", "forum_create_reply", "forum_send_chat_message", "forum_send_private_message", "forum_update_my_forum_profile", "forum_upload_attachments"])
      expect(hints(name).openWorldHint, name).toBe(true);
    for (const name of ["forum_open", "forum_status", "forum_list_private_messages", "forum_get_private_message", "forum_get_my_forum_notification_preferences", "forum_set_thread_bookmark"])
      expect(hints(name).openWorldHint, name).toBe(false);
    for (const name of ["forum_upsert_forum_category", "forum_upsert_announcement_admin", "forum_upsert_help_document_admin", "forum_upsert_calendar_event_admin", "forum_upsert_thread_prefix_admin", "forum_upsert_board_rules_admin", "forum_send_private_message", "forum_vote_poll", "forum_delete_thread", "forum_update_thread_content", "forum_update_user_forum_role", "forum_set_thread_bookmark"])
      expect(hints(name).destructiveHint, name).toBe(true);
    for (const name of ["forum_create_thread", "forum_create_reply", "forum_send_chat_message", "forum_mark_private_message_read", "forum_restore_private_message", "forum_upload_attachments"])
      expect(hints(name).destructiveHint, name).toBe(false);
  });
  test("entrypoint and server can share a transparent, theme-aware brand icon", () => {
    const opener = FORUM_PLUGIN_TOOLS.find(tool => tool.name === "forum_open")!;
    expect(opener.icons).toEqual([FORUM_PLUGIN_ICON]);
    expect(FORUM_PLUGIN_ICON.mimeType).toBe("image/png");
    expect(FORUM_PLUGIN_ICON.sizes).toEqual(["256x256"]);
    const png = Buffer.from(FORUM_PLUGIN_ICON.src.split(",")[1], "base64");
    expect(png.subarray(1,4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(256);
    expect(opener._meta["openai/ui"]).toEqual({ entrypoints: [{ type: "global" }, { type: "thread" }] });
  });
  test("catalog describes unlimited monthly forum use with temporary limits and unchanged authority", () => {
    const status = findForumPluginTool("forum_status")!;
    expect(status.description).toContain("no monthly usage limit");
    expect(status.description).toContain("expectedPolicyVersion");
    const chat = findForumPluginTool("forum_list_chat_messages")!;
    expect(chat.description).toContain("no monthly usage limit");
    expect(chat.description).toContain("current authorization");
    expect(chat.description).toContain("short-term owner request limits");
    expect(JSON.stringify(FORUM_PLUGIN_TOOLS)).not.toMatch(/monthly write allowance|allowance with its reset|Developer settings/);
  });

  test("covers each forum surface without internal maintenance or toggle tools", () => {
    const operations = new Set(
      FORUM_PLUGIN_OPERATIONS.map((tool) => tool.operation),
    );
    for (const operation of [
      "listCategories",
      "listFeedThreads",
      "listNewsFeed",
      "listChatMessages",
      "sendChatMessage",
      "deleteChatMessage",
      "listChatPendingMessages",
      "moderateChatMessage",
      "search",
      "getMyForumExperience",
      "updateMyForumExperience",
      "listMyForumCatchUp",
      "setAcceptedAnswer",
      "getNewsDiscussion",
      "createNewsDiscussion",
      "createThreadFromChat",
      "markChatRead",
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
      "feedAuthorizationFingerprint",
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
    expect(
      FORUM_PLUGIN_TOOLS.find((tool) => tool.name === "forum_open"),
    ).toMatchObject({ name: "forum_open", title: "SYMBaiEX Forum" });
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
  test("global feed and stored news share public read permissions and bounded contracts", () => {
    for (const name of ["forum_list_feed_threads", "forum_list_news_feed"]) {
      expect(findForumPluginTool(name)).toMatchObject({
        capability: "read",
        readOnly: true,
        publicRead: true,
        destructive: false,
      });
    }
    const feed = findForumPluginTool("forum_list_feed_threads")!;
    expect(
      validateForumPluginArguments(feed, {
        sort: "new",
        communityOnly: true,
        paginationOpts: { numItems: 12, cursor: null },
      }),
    ).toBeNull();
    expect(
      validateForumPluginArguments(feed, {
        sort: "unread",
        paginationOpts: { numItems: 12, cursor: null },
      }),
    ).not.toBeNull();
    expect(
      validateForumPluginArguments(feed, { sort: "active" }),
    ).not.toBeNull();
    expect(
      validateForumPluginArguments(
        findForumPluginTool("forum_list_news_feed")!,
        { snapshotDate: "2026-10-02", limit: 12 },
      ),
    ).toBeNull();
  });

  test("chat tools share explicit participation and delegated staff policy with bounded inputs", () => {
    expect(findForumPluginTool("forum_list_chat_messages")).toMatchObject({ capability: "read", publicRead: true, readOnly: true });
    for (const name of ["forum_list_chat_pending_messages", "forum_moderate_chat_message"]) expect(findForumPluginTool(name)).toMatchObject({ capability: "moderate", publicRead: false });
    const read = findForumPluginTool("forum_list_chat_messages")!;
    expect(validateForumPluginArguments(read, { paginationOpts: { numItems: 60, cursor: null } })).toBeNull();
    expect(validateForumPluginArguments(read, { paginationOpts: { numItems: 61, cursor: null } })).not.toBeNull();
    const write = findForumPluginTool("forum_send_chat_message")!;
    expect(write).toMatchObject({ capability: "participate", readOnly: false });
    expect(validateForumPluginArguments(write, { body: "Hello", expectedPolicyVersion: 1, idempotencyKey: "chat-retry-123" })).toBeNull();
    expect(validateForumPluginArguments(write, { body: "a".repeat(2001), expectedPolicyVersion: 1, idempotencyKey: "chat-retry-123" })).not.toBeNull();
    expect(validateForumPluginArguments(write, { body: "Hello", idempotencyKey: "chat-retry-123" })).not.toBeNull();
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

 test("private conversation tools require messages consent and never advertise anonymous reads", () => {
   for (const name of ["getPrivateMessageAccess", "listPrivateMessageConversations", "getPrivateMessageConversation", "listPrivateMessageRecipients", "createPrivateMessageConversation", "sendPrivateMessageConversation", "setPrivateMessageConversation", "reportPrivateMessageConversation"]) {
     expect(getForumPluginOperation(name)).toMatchObject({ capability: "messages", publicRead: false });
   }
 });
