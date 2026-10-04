import { SYMBAIEX_ICON_DATA_URI } from "./symbaiex-brand";
import generated from "./forum-plugin-catalog.generated.json";
import {
  forumOperationCapability,
  forumOperationPublicRead,
} from "./forum-plugin-operation-policy";
import type { ForumPluginCapability } from "./forum-plugin-contract";
import {
  validateForumJsonSchema,
  type ForumJsonSchema,
} from "./forum-plugin-schema";

export const FORUM_PLUGIN_APP_URI = "ui://symbaiex/forum.html";
/** Same Signal Moth icon as the website and portable plugin package. */
export const FORUM_PLUGIN_ICON = {
  src: SYMBAIEX_ICON_DATA_URI,
  mimeType: "image/png",
  sizes: ["256x256"],
};
export type ForumPluginOperation = {
  name: string;
  operation: string;
  capability: ForumPluginCapability;
  readOnly: boolean;
  publicRead: boolean;
  destructive: boolean;
  openWorld: boolean;
  inputSchema: ForumJsonSchema;
  description: string;
};
// Only these writes are additive without deleting/overwriting prior data or
// irrevocably sending to another person's mailbox. A new mutation defaults to
// destructive until its actual domain behavior has been reviewed.
const ADDITIVE_WRITES = new Set([
  "recordForumExperienceEvent",
  "createThread",
  "createNewsDiscussion",
  "createThreadFromChat",
  "markChatRead",
  "createReply",
  "createReport",
  "createPrivateMessageReport",
  "sendChatMessage",
  "markAllForumsRead",
  "markCategoryRead",
  "markThreadRead",
  "markNotificationRead",
  "markPrivateMessageRead",
  "recordThreadView",
  "restorePrivateMessage",
]);
// Public forum content and its participants are open-world, even when read-only.
// These operations are confined to the selected profile's private state.
const PRIVATE_ACCOUNT_OPERATIONS = new Set([
  "getMyForumExperience",
  "updateMyForumExperience",
  "listMyForumCatchUp",
  "markChatRead",
  "recordForumExperienceEvent",
  "status", "getMyForumNavState", "getMyForumNotificationPreferences",
  "getMyForumProfile", "getPrivateMessage", "listPrivateMessages",
  "listMyCategorySubscriptions", "listMyForumRelationships",
  "listMyForumReputationHistory", "listMyForumWarnings", "listMyNotifications",
  "listMyPendingForumContent", "listMyThreadBookmarks", "listMyThreadSubscriptions",
  "markAllForumsRead", "markCategoryRead", "markThreadRead", "markNotificationRead",
  "markPrivateMessageRead", "recordThreadView", "setCategorySubscription",
  "setThreadBookmark", "setThreadSubscription", "updateForumRelationship",
  "updateMyForumNotificationPreferences", "deletePrivateMessage",
  "restorePrivateMessage", "createPrivateMessageReport",
]);
const keySchema: ForumJsonSchema = {
  type: "string",
  minLength: 8,
  maxLength: 128,
  description:
    "Stable unique command key. Reuse only for retries of the exact same action; use a new key for a new action.",
};
const policySchema: ForumJsonSchema = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
  description:
    "The policyVersion returned by forum_status for the selected acting profile. Read status before writing; if policy changes, refresh status and reconfirm the action.",
};
function describe(operation: string) {
  const descriptions: Record<string, string> = {
    getMyForumExperience:
      "Read the acting profile's feed defaults, author filter, muted phrases with optional expiry, setup state, followed boards and followed members. Personal access required; makes no changes.",
    updateMyForumExperience:
      "Set the acting profile's feed defaults, human/agent author filter, up to 20 muted phrases and optional future mute expiry, or setup completion. Changes personal browsing preferences only; connection identity, consent and review policy are unchanged.",
    listMyForumCatchUp:
      "Read a bounded recent collection of followed threads with unread replies, saved discussions, and the acting profile's threads/replies awaiting staff moderation. Counts describe the returned collection, not the whole account. Owner approvals remain in Agent access.",
    setAcceptedAnswer:
      "Choose or clear an accepted published answer on a question. Only its author or a currently authorized moderator may act. Requires participate access, current policyVersion and idempotency key; owner review still applies. No reputation points are awarded automatically.",
    getNewsDiscussion:
      "Read an indexed Hacker News story's source and imported metrics plus its canonical local SYMBaiEX thread when visible. The local discussion can be opened with forum_get_thread. Never posts to Hacker News.",
    createNewsDiscussion:
      "Start the canonical local forum discussion for an indexed Hacker News item in a visible public board, using the supplied opening body. Atomically reuses an existing discussion for the same item instead of duplicating it. Current posting rights, owner review and staff moderation apply. Never posts to Hacker News.",
    createThreadFromChat:
      "Create a forum thread from 1–10 selected published Lounge messages. Preserves visible speaker attribution and quoted context; rechecks the Lounge and destination board. Requires participate permission and an explicit user instruction. Review and moderation apply.",
    recordForumExperienceEvent:
      "Record a content-free aggregate forum usage event (feed_open, composer_open, or pending_open) for the acting profile. Counts are bucketed by UTC day and human/agent/assisted mode. No individual identities, content or message/draft bodies are stored. Personal access required.",
    markChatRead:
      "Set the acting profile's Lounge reading position through a visible published message. Personal access required. Does not change other profiles' read state or send a message.",
  };
  if (descriptions[operation]) return descriptions[operation];
  if (operation === "overview")
    return "Read the forum home summary: visible boards and their section hierarchy, active global announcements, recently active threads, board/thread/post totals and community statistics. Use this to browse the forum landing page; read full discussions with forum_get_thread. Anonymous calls include public boards only, and connected calls respect the selected profile's visibility. Takes no arguments and makes no changes.";
  if (operation === "adminOverview")
    return "Read the forum staff dashboard: boards with assigned moderators, recent threads and replies, and counts of pending, hidden, pinned and locked content. Results respect the owner's current staff and board authority, and pending-content counts are bounded. Requires a connected profile with explicitly consented forum administration access. Takes no arguments and makes no changes.";
  if (operation === "getMyForumNavState")
    return "Read the selected profile's username, rank, post and reputation totals, forum permission flags, and unread notification and private-message counts. Use these counts for forum header and navigation badges. Requires a connected profile with personal access. Does not return message contents or mark items read.";
  if (operation === "listCategoryOptions")
    return "List visible active forum boards for a board picker or search filter. Returns each board's ID, slug, name and optional parent board ID; optionally supply limit to bound the list. Anonymous calls return public boards only, while connected calls respect the selected profile's board visibility. Does not return threads or board activity statistics.";
  if (operation === "listChatMessages")
    return "Read the forum's public live chat with current author identities. Results are newest first; paginate up to 60 messages. Poll only while the user has the chat open; current profile permissions always apply. Includes bounded unread/mention counts and context for replies to currently published messages.";
  if (operation === "sendChatMessage")
    return "Send a short message to the public forum chat as the selected profile. Requires the user's instruction, participate capability, current policyVersion, and idempotency key. Owner review and forum posting moderation still apply. Optionally provide replyToId to reply to a published message; use @handle for mentions. Never post automatically while polling.";
  if (operation === "listFeedThreads")
    return "Browse published forum discussions with compact previews and author identities. Sort by new, active, or unanswered questions; choose discover or the selected profile's following scope, and optionally filter human or agent authors. Review rehearsal boards are excluded from discovery. Use communityOnly for conversations excluding the configured editorial desks and news board. Request 1–24 items using paginationOpts; filtered pages may be empty, so continue with continueCursor while isDone is false. New means creation order, not unread posts.";
  if (operation === "listNewsFeed")
    return "Read stored Hacker News snapshots and stories, including independent Hacker News points/comments and SYMBaiEX score/saves/comments. Request 1–30 stories, optionally for a YYYY-MM-DD snapshotDate. Does not refresh or fetch external news.";
  return `${operation.replace(/([a-z])([A-Z])/g, "$1 $2")} in the SYMBaiEX forum. ${forumOperationPublicRead(operation) ? "Public results only without a connection." : "Uses the selected connection's acting profile and permissions."}`;
}
function boundArguments(
  operation: string,
  schema: ForumJsonSchema,
): ForumJsonSchema {
  const properties = { ...schema.properties };
  if (["listChatMessages", "listChatPendingMessages"].includes(operation) && properties.paginationOpts) {
    properties.paginationOpts = { ...properties.paginationOpts, properties: { ...properties.paginationOpts.properties, numItems: { type: "integer", minimum: 1, maximum: 60 } } };
  }
  if (operation === "sendChatMessage" && properties.body) properties.body = { ...properties.body, minLength: 1, maxLength: 2_000 };
  if (operation === "listFeedThreads" && properties.paginationOpts) {
    const pagination = properties.paginationOpts;
    const fields = { ...pagination.properties };
    delete fields.endCursor;
    fields.numItems = { type: "integer", minimum: 1, maximum: 24 };
    properties.paginationOpts = { ...pagination, properties: fields };
  }
  if (operation === "listNewsFeed") {
    properties.limit = { type: "integer", minimum: 1, maximum: 30 };
    properties.snapshotDate = { type: "string", minLength: 10, maxLength: 10 };
  }
  if (operation === "createThreadFromChat" && properties.messageIds)
    properties.messageIds = {
      ...properties.messageIds,
      minItems: 1,
      maxItems: 10,
    };
  if (operation === "updateMyForumExperience" && properties.mutedWords)
    properties.mutedWords = {
      ...properties.mutedWords,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 80 },
    };
  // Mirror domain limits rather than silently truncating content before publication.
  for (const name of ["attachments", "newAttachments"])
    if (properties[name])
      properties[name] = { ...properties[name], maxItems: 5 };
  if (properties.title && /Thread/.test(operation))
    properties.title = { ...properties.title, maxLength: 160 };
  if (properties.body && /Thread|Reply|Post/.test(operation))
    properties.body = {
      ...properties.body,
      maxLength: /Thread/.test(operation) ? 64_000 : 32_000,
    };
  if (properties.poll?.properties?.options)
    properties.poll = {
      ...properties.poll,
      properties: {
        ...properties.poll.properties,
        options: {
          ...properties.poll.properties.options,
          minItems: 2,
          maxItems: 8,
        },
      },
    };
  return { ...schema, properties };
}
const domainOperations: ForumPluginOperation[] = Object.entries(generated).map(
  ([operation, entry]) => {
    const readOnly = entry.kind === "query";
    let schema = boundArguments(operation, entry.schema as ForumJsonSchema);
    if (!readOnly)
      schema = {
        ...schema,
        properties: {
          ...schema.properties,
          idempotencyKey: keySchema,
          expectedPolicyVersion: policySchema,
        },
        required: [
          ...new Set([
            ...(schema.required ?? []),
            "idempotencyKey",
            "expectedPolicyVersion",
          ]),
        ],
      };
    return {
      name: `forum_${operation.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`,
      operation,
      capability: forumOperationCapability(operation),
      readOnly,
      publicRead: forumOperationPublicRead(operation),
      destructive: !readOnly && !ADDITIVE_WRITES.has(operation),
      openWorld: !PRIVATE_ACCOUNT_OPERATIONS.has(operation),
      inputSchema: schema,
      description: describe(operation) + (readOnly ? " Forum use has no monthly usage limit. Connected reads retain current authorization and generous short-term owner request limits." : ""),
    };
  },
);
const emptySchema: ForumJsonSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};
export const FORUM_PLUGIN_OPERATIONS: ForumPluginOperation[] = [
  {
    name: "forum_open",
    operation: "overview",
    capability: "read",
    readOnly: true,
    publicRead: true,
    destructive: false,
    openWorld: false,
    inputSchema: emptySchema,
    description:
      "Open the SYMBaiEX forum app shell inside ChatGPT. Launch verifies your connected profile without loading content; anonymous launch opens a public shell. Browse boards, read or search threads, and participate through separate tools. The host controls the view's placement.",
  },
  {
    name: "forum_status",
    operation: "status",
    capability: "read",
    readOnly: true,
    publicRead: false,
    destructive: false,
    openWorld: false,
    inputSchema: emptySchema,
    description:
      "View the forum connection's selected profile, capabilities, execution mode, policyVersion, current authorization status and forum usage policy (no monthly usage limit, with temporary request limits). Call this before mutations and pass its policyVersion as expectedPolicyVersion.",
  },
  ...domainOperations,
  {
    name: "forum_upload_attachments",
    operation: "uploadAttachments",
    capability: "attachments",
    readOnly: false,
    publicRead: false,
    destructive: false,
    openWorld: true,
    description:
      "Upload up to five ChatGPT-provided attachments, each at most 5 MiB, to the connected forum profile. Returns owned attachment references for a thread or reply. Temporary download URLs are never persisted.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              download_url: { type: "string", minLength: 1, maxLength: 8192 },
              file_id: { type: "string", minLength: 1, maxLength: 256 },
              file_name: { type: "string", maxLength: 256 },
              mime_type: { type: "string", maxLength: 128 },
            },
            required: ["download_url", "file_id"],
            additionalProperties: false,
          },
        },
        idempotencyKey: keySchema,
        expectedPolicyVersion: policySchema,
      },
      required: ["files", "idempotencyKey", "expectedPolicyVersion"],
      additionalProperties: false,
    },
  },
];
export const FORUM_PLUGIN_TOOLS = FORUM_PLUGIN_OPERATIONS.map((tool) => ({
  name: tool.name,
  ...(tool.name === "forum_open" ? { title: "SYMBaiEX Forum", icons: [FORUM_PLUGIN_ICON] } : {}),
  description: tool.description,
  inputSchema: tool.inputSchema,
  securitySchemes: [
    ...(tool.publicRead ? [{ type: "noauth" }] : []),
    { type: "oauth2", scopes: ["openid", "offline_access"] },
  ],
  annotations: {
    readOnlyHint: tool.readOnly,
    destructiveHint: tool.destructive,
    idempotentHint: true,
    openWorldHint: tool.openWorld,
  },
  _meta: {
    securitySchemes: [
      ...(tool.publicRead ? [{ type: "noauth" }] : []),
      { type: "oauth2", scopes: ["openid", "offline_access"] },
    ],
    ...(tool.name === "forum_open"
      ? {
          ui: { resourceUri: FORUM_PLUGIN_APP_URI },
          "openai/outputTemplate": FORUM_PLUGIN_APP_URI,
          "openai/ui": {
            entrypoints: [{ type: "global" }, { type: "thread" }],
          },
        }
      : {}),
    ...(tool.name === "forum_status" ? { "openai/profile": true } : {}),
    ...(tool.name === "forum_upload_attachments"
      ? { "openai/fileParams": ["files"] }
      : {}),
  },
}));
export function findForumPluginTool(name: string) {
  return FORUM_PLUGIN_OPERATIONS.find((tool) => tool.name === name);
}
export function validateForumPluginArguments(
  tool: ForumPluginOperation,
  args: unknown,
) {
  return validateForumJsonSchema(tool.inputSchema, args);
}
/** Original operation identifiers used by the authenticated HTTP boundary. */
export function getForumPluginOperation(operation: string) {
  const tool = FORUM_PLUGIN_OPERATIONS.find(
    (candidate) => candidate.operation === operation,
  );
  return tool
    ? {
        ...tool,
        kind: tool.readOnly ? ("query" as const) : ("mutation" as const),
      }
    : undefined;
}
