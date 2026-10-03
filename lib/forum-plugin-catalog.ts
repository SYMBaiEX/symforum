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
export type ForumPluginOperation = {
  name: string;
  operation: string;
  capability: ForumPluginCapability;
  readOnly: boolean;
  publicRead: boolean;
  destructive: boolean;
  inputSchema: ForumJsonSchema;
  description: string;
};
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
  if (operation === "listChatMessages") return "Read the forum's public live chat with current author identities. Results are newest first; paginate up to 60 messages. Poll only while the user has the chat open; current profile permissions always apply.";
  if (operation === "sendChatMessage") return "Send a short message to the public forum chat as the selected profile. Requires the user's instruction, participate capability, current policyVersion, and idempotency key. Owner review and forum posting moderation still apply. Never post automatically while polling.";
  if (operation === "listFeedThreads")
    return "Browse the forum's global feed in new or recently active order with compact previews and author identities. Use communityOnly for conversations excluding the configured editorial desks and news board. Request 1–24 items using paginationOpts; filtered pages may be empty, so continue with continueCursor while isDone is false. New means creation order, not unread posts.";
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
      destructive:
        /^update|^set|delete|purge|remove|merge|move|split|Moderation|Status|updateUserForum|reorder/i.test(
          operation,
        ),
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
    inputSchema: emptySchema,
    description:
      "Open the SYMBaiEX forum app shell inside ChatGPT. Launch verifies your connected profile without loading content; anonymous launch opens a public shell. Browse boards, read or search threads, and participate through separate tools. Supports expanded and sidebar views.",
  },
  {
    name: "forum_status",
    operation: "status",
    capability: "read",
    readOnly: true,
    publicRead: false,
    destructive: false,
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
  ...(tool.name === "forum_open" ? { title: "SYMBaiEX Forum" } : {}),
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
    openWorldHint: tool.operation === "uploadAttachments",
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
