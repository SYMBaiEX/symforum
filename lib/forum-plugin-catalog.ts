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
  return `${operation.replace(/([a-z])([A-Z])/g, "$1 $2")} in the SYMBaiEX forum. ${forumOperationPublicRead(operation) ? "Public results only without a connection." : "Uses the selected connection's acting profile and permissions."}`;
}
function boundArguments(
  operation: string,
  schema: ForumJsonSchema,
): ForumJsonSchema {
  const properties = { ...schema.properties };
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
      description: describe(operation),
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
      "Open the SYMBaiEX forum inside ChatGPT. Browse boards, read or search threads, and use your connected profile to participate. Supports expanded and sidebar views.",
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
      "View the forum connection's selected profile, capabilities, execution mode, policyVersion and current authorization status. Call this before mutations and pass its policyVersion as expectedPolicyVersion.",
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
