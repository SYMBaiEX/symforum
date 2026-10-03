import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v, type PropertyValidators } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { forumOperations } from "./forum";
import { forumAccountOperations } from "./admin";
import {
  requirePluginOwner,
  requirePluginPrincipal,
  requirePluginCapability,
  effectivePluginCapabilities,
  type ForumPluginPrincipal,
  withVerifiedPluginOAuth,
  verifiedOAuthPrincipalValidator,
} from "./forumPluginPrincipal";
import { withForumPluginPrincipal } from "./forumPluginContext";
import { consumeForumPluginQuota } from "./agentQuota";
import {
  canonicalForumJson,
  validateForumOperationArgs,
} from "./forumPluginValidation";
import {
  forumOperationCapability,
  forumOperationPublicRead,
} from "../lib/forum-plugin-operation-policy";
import {
  FORUM_PLUGIN_PROPOSAL_TTL_MS,
  FORUM_PLUGIN_RESOURCE,
  type ForumPluginResult,
} from "../lib/forum-plugin-contract";
import { sha256Base64Url } from "./agentIdentityCrypto";

type Operation = {
  kind: "query" | "mutation";
  definition: {
    args: PropertyValidators;
    handler: (
      ctx: QueryCtx | MutationCtx,
      args: Record<string, unknown>,
    ) => unknown;
  };
};
const operations = {
  ...forumOperations,
  ...forumAccountOperations,
} as unknown as Record<string, Operation>;
const proposalRateLimiter = new RateLimiter(components.rateLimiter, {
  forumPluginOwnerProposals: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },
  forumPluginCredentialProposals: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 20,
  },
});
const expireCommandRef = makeFunctionReference<
  "mutation",
  { commandId: Id<"forumPluginCommands"> },
  null
>("forumPlugin:cleanupStagedPluginUpload");
const internalOnly = new Set([
  "authorizeForumAttachmentUpload",
  "claimStoredForumAttachmentUpload",
]);
const requestArgs = {
  connectionId: v.optional(v.id("forumPluginConnections")),
  expectedPolicyVersion: v.optional(v.number()),
  operation: v.string(),
  args: v.record(v.string(), v.any()),
};
const proofArgs = {
  verifiedResource: v.literal(FORUM_PLUGIN_RESOURCE),
  verifiedOAuthPrincipal: v.optional(verifiedOAuthPrincipalValidator),
};
const readArgs = { ...requestArgs, idempotencyKey: v.optional(v.string()) };
const executeArgs = {
  ...requestArgs,
  expectedPolicyVersion: v.number(),
  idempotencyKey: v.string(),
};
const resultValidator = v.any();

function operationFor(
  name: string,
  kind: "query" | "mutation",
  allowInternal = false,
) {
  const operation = Object.hasOwn(operations, name)
    ? operations[name]
    : undefined;
  if (
    !operation ||
    operation.kind !== kind ||
    (!allowInternal && internalOnly.has(name))
  )
    throw new ConvexError({
      code: "PLUGIN_OPERATION_NOT_FOUND",
      message: "That forum operation is not available.",
    });
  return operation;
}
function assertPrincipalActive(
  principal: ForumPluginPrincipal,
  credential: Doc<"users"> | null,
) {
  for (const user of [principal.owner, principal.actor, credential]) {
    if (
      !user ||
      user.forumBannedAt !== undefined ||
      (user.forumSuspendedUntil ?? 0) > Date.now()
    )
      throw new ConvexError({
        code: "PLUGIN_ACCOUNT_RESTRICTED",
        message: "The owner or acting profile is restricted.",
      });
  }
}
async function checkedPrincipal(
  ctx: QueryCtx | MutationCtx,
  connectionId: Id<"forumPluginConnections"> | undefined,
  operation: string,
  verifiedResource?: typeof FORUM_PLUGIN_RESOURCE,
) {
  const principal = await requirePluginPrincipal(ctx, {
    connectionId,
    verifiedResource,
  });
  requirePluginCapability(principal, forumOperationCapability(operation));
  assertPrincipalActive(
    principal,
    await ctx.db.get("users", principal.credentialAgent.userId),
  );
  return principal;
}
function actingAs(principal: ForumPluginPrincipal | null) {
  return principal
    ? {
        userId: String(principal.actor._id),
        username: principal.actor.username ?? principal.actor.name ?? "",
        isAgent: principal.actor.isAgent === true,
      }
    : null;
}
function plainResult(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}
async function readOperation(
  ctx: QueryCtx | MutationCtx,
  args: {
    connectionId?: Id<"forumPluginConnections">;
    expectedPolicyVersion?: number;
    idempotencyKey?: string;
    operation: string;
    args: Record<string, unknown>;
  },
  remote = false,
  verifiedResource?: typeof FORUM_PLUGIN_RESOURCE,
) {
  if (
    !remote &&
    (args.connectionId || !forumOperationPublicRead(args.operation))
  )
    await requirePluginOwner(ctx);
  if (args.operation === "status") {
    validateForumOperationArgs(ctx, {}, args.args);
    const principal = await checkedPrincipal(
      ctx,
      args.connectionId,
      "status",
      verifiedResource,
    );
    if (
      args.expectedPolicyVersion !== undefined &&
      args.expectedPolicyVersion !== principal.policyVersion
    )
      throw new ConvexError("The acting profile or connection policy changed.");
    return {
      status: "completed",
      actingAs: actingAs(principal),
      data: {
        connectionId: principal.connection._id,
        capabilities: principal.capabilities,
        executionMode: principal.connection.executionMode,
        policyVersion: principal.policyVersion,
      },
    };
  }
  const operation = operationFor(args.operation, "query");
  validateForumOperationArgs(ctx, operation.definition.args, args.args);
  const principal =
    args.connectionId || remote || !forumOperationPublicRead(args.operation)
      ? await checkedPrincipal(
          ctx,
          args.connectionId,
          args.operation,
          verifiedResource,
        )
      : null;
  if (
    principal &&
    args.expectedPolicyVersion !== undefined &&
    args.expectedPolicyVersion !== principal.policyVersion
  )
    throw new ConvexError({
      code: "PLUGIN_POLICY_CHANGED",
      message:
        "The acting profile or connection policy changed. Refresh the forum tools.",
    });
  if (principal) {
    if (!("insert" in ctx.db))
      throw new ConvexError(
        "Connected forum reads require a transactional quota context.",
      );
    // Read requests intentionally consume quota on every invocation. Client keys
    // are trace-only: reusing one must not enable unlimited fresh-state polling.
    const nonce = `${Date.now()}:${Math.random()}:${Math.random()}`;
    await consumeForumPluginQuota(ctx as MutationCtx, principal, {
      operation: `forum.read.${args.operation}`,
      idempotencyKey: `plugin-read:${await sha256Base64Url(String(principal.connection._id) + ":" + principal.actor._id + ":" + args.operation + ":" + nonce)}`,
      requestFingerprint: await sha256Base64Url(
        canonicalForumJson({
          operation: args.operation,
          actor: principal.actor._id,
          args: args.args,
        }),
      ),
    });
  }
  const anonymousCtx: QueryCtx = {
    ...ctx,
    auth: { getUserIdentity: async () => null },
  };
  const data = plainResult(
    await operation.definition.handler(
      principal ? withForumPluginPrincipal(ctx, principal) : anonymousCtx,
      args.args,
    ),
  );
  return { status: "completed", actingAs: actingAs(principal), data };
}
export const read = mutation({
  args: readArgs,
  returns: resultValidator,
  handler: async (ctx, args) => readOperation(ctx, args),
});
export const publicRead = internalQuery({
  args: requestArgs,
  returns: resultValidator,
  handler: async (ctx, args) => {
    if (args.connectionId || !forumOperationPublicRead(args.operation))
      throw new ConvexError("This operation requires a connection.");
    return readOperation(ctx, args);
  },
});
export const remoteRead = internalMutation({
  args: { ...readArgs, ...proofArgs },
  returns: resultValidator,
  handler: async (ctx, args) =>
    readOperation(
      args.verifiedOAuthPrincipal
        ? withVerifiedPluginOAuth(
            ctx,
            args.verifiedOAuthPrincipal,
            args.verifiedResource,
          )
        : ctx,
      args,
      true,
      args.verifiedResource,
    ),
});

async function targetVersions(
  ctx: QueryCtx | MutationCtx,
  args: Record<string, unknown>,
): Promise<string> {
  const targets: Record<string, unknown> = {};
  // Snapshot only records explicitly selected by a command, never unrelated member activity.
  const tables = [
    "users",
    "forumCategories",
    "forumThreads",
    "forumPosts",
    "forumPolls",
    "forumPollOptions",
    "forumThreadPrefixes",
    "forumWarnings",
    "forumReports",
    "forumPrivateMessages",
    "forumAnnouncements",
    "forumHelpDocuments",
    "forumCalendarEvents",
    "forumPendingUploads",
    "_storage",
  ] as const;
  async function visit(value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const child of value) await visit(child);
      return;
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) await visit(child);
      return;
    }
    if (typeof value !== "string") return;
    for (const table of tables) {
      if (table === "_storage") {
        const id = ctx.db.system.normalizeId("_storage", value);
        if (id) {
          targets[`${table}:${value}`] = await ctx.db.system.get(
            "_storage",
            id,
          );
          return;
        }
      } else {
        const id = ctx.db.normalizeId(table, value);
        if (id) {
          targets[`${table}:${value}`] = await ctx.db.get(table, id);
          return;
        }
      }
    }
  }
  await visit(args);
  for (const key of ["categorySlug", "recipientUsername", "username"]) {
    if (typeof args[key] !== "string") continue;
    const value = (args[key] as string).trim().toLowerCase();
    const doc =
      key === "categorySlug"
        ? await ctx.db
            .query("forumCategories")
            .withIndex("by_slug", (q) => q.eq("slug", value))
            .unique()
        : await ctx.db
            .query("users")
            .withIndex("by_usernameNormalized", (q) =>
              q.eq("usernameNormalized", value),
            )
            .unique();
    targets[key] = doc;
  }
  const digests: Record<string, string> = {};
  for (const [key, value] of Object.entries(targets))
    digests[key] = await sha256Base64Url(
      canonicalForumJson(relevantTargetState(key, value)),
    );
  return canonicalForumJson(digests);
}
function relevantTargetState(key: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const document = value as Record<string, unknown>;
  let fields: string[] | null = null;
  if (key.startsWith("forumCategories:") || key === "categorySlug")
    fields = [
      "_id",
      "slug",
      "kind",
      "parentCategoryId",
      "status",
      "viewAccess",
      "threadAccess",
      "replyAccess",
      "pollAccess",
    ];
  else if (key.startsWith("forumThreads:"))
    fields = [
      "_id",
      "authorId",
      "categoryId",
      "categorySlug",
      "slug",
      "title",
      "body",
      "prefixId",
      "status",
      "pinned",
    ];
  else if (key.startsWith("forumPosts:"))
    fields = [
      "_id",
      "authorId",
      "categoryId",
      "threadId",
      "body",
      "status",
      "postNumber",
    ];
  else if (key.startsWith("forumPolls:"))
    fields = [
      "_id",
      "threadId",
      "categoryId",
      "question",
      "status",
      "optionCount",
    ];
  else if (key.startsWith("forumPollOptions:"))
    fields = ["_id", "threadId", "pollId", "label", "position"];
  else if (
    key.startsWith("users:") ||
    key === "recipientUsername" ||
    key === "username"
  )
    fields = [
      "_id",
      "username",
      "usernameNormalized",
      "role",
      "forumRole",
      "forumTrustedAt",
      "forumTrustRevokedAt",
      "forumBannedAt",
      "forumSuspendedUntil",
      "isAgent",
      "agentStatus",
      "agentKeyVersion",
      "agentScopes",
    ];
  return fields
    ? Object.fromEntries(fields.map((field) => [field, document[field]]))
    : value;
}
function keyFor(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value))
    throw new ConvexError({
      code: "PLUGIN_INVALID_IDEMPOTENCY_KEY",
      message: "Use a 1-160 character idempotency key.",
    });
  return value;
}
function fingerprint(
  principal: ForumPluginPrincipal,
  operation: string,
  args: Record<string, unknown>,
) {
  const identityArgs =
    operation === "claimStoredForumAttachmentUpload"
      ? Object.fromEntries(
          Object.entries(args).filter(([key]) => key !== "storageId"),
        )
      : args;
  return canonicalForumJson({
    operation,
    actor: String(principal.actor._id),
    args: identityArgs,
  });
}
async function commandResult(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
  command: Doc<"forumPluginCommands">,
): Promise<ForumPluginResult> {
  if (command.status === "completed") return JSON.parse(command.resultJson!);
  if (command.status !== "pending")
    throw new ConvexError({
      code: "PLUGIN_COMMAND_CLOSED",
      message: `This command is ${command.status}.`,
    });
  if (command.expiresAt <= Date.now()) {
    await ctx.db.patch("forumPluginCommands", command._id, {
      status: "expired",
    });
    return {
      status: "pending_approval",
      actingAs: actingAs(principal),
      commandId: String(command._id),
      expiresAt: command.expiresAt,
      data: { state: "expired" },
    };
  }
  if (
    command.policyVersion !== principal.policyVersion ||
    command.actorUserId !== principal.actor._id
  ) {
    await ctx.db.patch("forumPluginCommands", command._id, {
      status: "invalidated",
    });
    return {
      status: "pending_approval",
      actingAs: actingAs(principal),
      commandId: String(command._id),
      data: { state: "invalidated" },
    };
  }
  return {
    status: "pending_approval",
    actingAs: actingAs(principal),
    commandId: String(command._id),
    approvalUrl: "https://forum.symbaiex.com/control-panel/agent-access",
    expiresAt: command.expiresAt,
  };
}
async function runCommand(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
  operationName: string,
  input: Record<string, unknown>,
  key: string,
  commandId?: Id<"forumPluginCommands">,
): Promise<ForumPluginResult> {
  const operation = operationFor(operationName, "mutation", true);
  const quotaKey = `plugin:${await sha256Base64Url(String(principal.connection._id) + ":" + key)}`;
  await consumeForumPluginQuota(ctx, principal, {
    operation: `forum.${operationName}`,
    idempotencyKey: quotaKey,
  });
  const handlerInput =
    operationName === "claimStoredForumAttachmentUpload"
      ? Object.fromEntries(
          Object.entries(input).filter(([name]) => name !== "contentHash"),
        )
      : input;
  const data = plainResult(
    await operation.definition.handler(
      withForumPluginPrincipal(ctx, principal),
      handlerInput,
    ),
  );
  let url: string | undefined;
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const nested =
    record?.thread && typeof record.thread === "object"
      ? (record.thread as Record<string, unknown>)
      : null;
  const threadId = record?.threadId ?? nested?._id;
  if (typeof threadId === "string") {
    const id = ctx.db.normalizeId("forumThreads", threadId);
    const thread = id ? await ctx.db.get("forumThreads", id) : null;
    if (thread)
      url = `https://forum.symbaiex.com/${thread.categorySlug}/${thread.slug}`;
  }
  const result: ForumPluginResult = {
    status: "completed",
    actingAs: actingAs(principal),
    data,
    commandId: commandId ? String(commandId) : undefined,
    url,
  };
  const now = Date.now();
  await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: "info",
    status: "open",
    source: "convex",
    scope: "forum-plugin",
    eventType: "forum_plugin_command",
    message: "Delegated forum command completed",
    fingerprint: `forum-plugin:${commandId ?? quotaKey}`,
    actorUserId: principal.actor._id,
    entityType: "forumPluginConnection",
    entityId: String(principal.connection._id),
    metadataJson: JSON.stringify({
      ownerUserId: principal.owner._id,
      credentialAgentId: principal.credentialAgent._id,
      operation: operationName,
      agentAssisted: true,
      actorMode: principal.connection.actorMode,
      commandId,
    }),
  });
  if (commandId)
    await ctx.db.patch("forumPluginCommands", commandId, {
      status: "completed",
      resultJson: JSON.stringify(result),
    });
  return result;
}
async function executeOperation(
  ctx: MutationCtx,
  args: {
    connectionId?: Id<"forumPluginConnections">;
    expectedPolicyVersion?: number;
    operation: string;
    args: Record<string, unknown>;
    idempotencyKey: string;
  },
  allowInternal = false,
  verifiedResource?: typeof FORUM_PLUGIN_RESOURCE,
): Promise<ForumPluginResult> {
  const operation = operationFor(args.operation, "mutation", allowInternal);
  const input =
    args.operation === "claimStoredForumAttachmentUpload"
      ? Object.fromEntries(
          Object.entries(args.args).filter(([name]) => name !== "contentHash"),
        )
      : args.args;
  validateForumOperationArgs(ctx, operation.definition.args, input);
  if (Array.isArray(input.attachments) && input.attachments.length > 0) {
    const principal = await checkedPrincipal(
      ctx,
      args.connectionId,
      args.operation,
      verifiedResource,
    );
    requirePluginCapability(principal, "attachments");
  }
  const principal = await checkedPrincipal(
    ctx,
    args.connectionId,
    args.operation,
    verifiedResource,
  );
  if (
    args.expectedPolicyVersion !== undefined &&
    args.expectedPolicyVersion !== principal.policyVersion
  )
    throw new ConvexError({
      code: "PLUGIN_POLICY_CHANGED",
      message:
        "The acting profile or connection policy changed. Refresh the forum tools.",
    });
  const key = keyFor(args.idempotencyKey);
  const boundFingerprint = fingerprint(principal, args.operation, args.args);
  const existing = await ctx.db
    .query("forumPluginCommands")
    .withIndex("by_connectionId_and_idempotencyKey", (q) =>
      q.eq("connectionId", principal.connection._id).eq("idempotencyKey", key),
    )
    .unique();
  if (existing) {
    if (existing.fingerprint !== boundFingerprint)
      throw new ConvexError({
        code: "PLUGIN_IDEMPOTENCY_CONFLICT",
        message: "This key already belongs to a different command.",
      });
    return commandResult(ctx, principal, existing);
  }
  const now = Date.now();
  if (principal.connection.executionMode === "review")
    await admitProposal(ctx, principal);
  if (
    principal.connection.executionMode === "review" &&
    Array.isArray(input.attachments)
  ) {
    for (const attachment of input.attachments as Array<{
      storageId: Id<"_storage">;
    }>) {
      const pending = await ctx.db
        .query("forumPendingUploads")
        .withIndex("by_userId_and_storageId", (q) =>
          q
            .eq("userId", principal.actor._id)
            .eq("storageId", attachment.storageId),
        )
        .unique();
      if (
        !pending ||
        pending.status !== "pending" ||
        (pending.expiresAt ?? 0) <= now
      )
        throw new ConvexError({
          code: "INVALID_ATTACHMENT",
          message:
            "An attachment must be a current upload owned by the acting profile.",
        });
      await ctx.db.patch("forumPendingUploads", pending._id, {
        expiresAt: now + FORUM_PLUGIN_PROPOSAL_TTL_MS,
        updatedAt: now,
      });
    }
  }
  const id = await ctx.db.insert("forumPluginCommands", {
    connectionId: principal.connection._id,
    ownerUserId: principal.owner._id,
    actorUserId: principal.actor._id,
    operation: args.operation,
    idempotencyKey: key,
    fingerprint: boundFingerprint,
    argsJson: canonicalForumJson(args.args),
    policyVersion: principal.policyVersion,
    targetVersionsJson: await targetVersions(ctx, args.args),
    status: "pending",
    createdAt: now,
    expiresAt: now + FORUM_PLUGIN_PROPOSAL_TTL_MS,
  });
  if (principal.connection.executionMode === "review")
    await ctx.scheduler.runAfter(
      FORUM_PLUGIN_PROPOSAL_TTL_MS,
      expireCommandRef,
      { commandId: id },
    );
  if (principal.connection.executionMode === "review")
    return commandResult(
      ctx,
      principal,
      (await ctx.db.get("forumPluginCommands", id))!,
    );
  return runCommand(ctx, principal, args.operation, args.args, key, id);
}
export const execute = mutation({
  args: executeArgs,
  returns: resultValidator,
  handler: async (ctx, args) => {
    await requirePluginOwner(ctx);
    return executeOperation(ctx, args);
  },
});
export const remoteExecute = internalMutation({
  args: { ...executeArgs, ...proofArgs },
  returns: resultValidator,
  handler: async (ctx, args) =>
    executeOperation(
      args.verifiedOAuthPrincipal
        ? withVerifiedPluginOAuth(
            ctx,
            args.verifiedOAuthPrincipal,
            args.verifiedResource,
          )
        : ctx,
      args,
      false,
      args.verifiedResource,
    ),
});
export const status = internalQuery({
  args: {
    connectionId: v.optional(v.id("forumPluginConnections")),
    ...proofArgs,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.verifiedOAuthPrincipal)
      ctx = withVerifiedPluginOAuth(
        ctx,
        args.verifiedOAuthPrincipal,
        args.verifiedResource,
      );
    const p = await checkedPrincipal(
      ctx,
      args.connectionId,
      "status",
      args.verifiedResource,
    );
    return {
      connectionId: p.connection._id,
      actingAs: actingAs(p),
      capabilities: p.capabilities,
      executionMode: p.connection.executionMode,
      policyVersion: p.policyVersion,
    };
  },
});
export const listCommands = query({
  args: { connectionId: v.optional(v.id("forumPluginConnections")) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const rows = await ctx.db
      .query("forumPluginCommands")
      .withIndex("by_ownerUserId_and_status_and_createdAt", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "pending"),
      )
      .order("desc")
      .take(100);
    return await Promise.all(
      rows
        .filter(
          (row) => !args.connectionId || row.connectionId === args.connectionId,
        )
        .map(async (row) => {
          const connection = await ctx.db.get(
            "forumPluginConnections",
            row.connectionId,
          );
          return {
            ...row,
            args: JSON.parse(row.argsJson),
            status:
              !connection ||
              connection.status !== "active" ||
              connection.policyVersion !== row.policyVersion ||
              connection.actorUserId !== row.actorUserId
                ? "invalidated"
                : row.expiresAt <= Date.now()
                  ? "expired"
                  : row.status,
          };
        }),
    );
  },
});
export const approveCommand = mutation({
  args: { commandId: v.id("forumPluginCommands") },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const command = await ctx.db.get("forumPluginCommands", args.commandId);
    if (!command || command.ownerUserId !== owner._id)
      throw new ConvexError("Command not found.");
    // Owner approval of OAuth proposals uses browser owner authority, without fabricating an OAuth token.
    const principal = await principalForOwnerApproval(ctx, owner, command);
    const current = await commandResult(ctx, principal, command);
    if (command.status === "completed" || current.data) return current;
    const input = JSON.parse(command.argsJson) as Record<string, unknown>;
    if ((await targetVersions(ctx, input)) !== command.targetVersionsJson) {
      await ctx.db.patch("forumPluginCommands", command._id, {
        status: "invalidated",
      });
      return {
        ...current,
        data: { state: "invalidated", reason: "target_changed" },
      };
    }
    requirePluginCapability(
      principal,
      forumOperationCapability(command.operation),
    );
    const operation = operationFor(command.operation, "mutation", true);
    validateForumOperationArgs(
      ctx,
      operation.definition.args,
      Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== "contentHash"),
      ),
    );
    if (Array.isArray(input.attachments) && input.attachments.length)
      requirePluginCapability(principal, "attachments");
    return runCommand(
      ctx,
      principal,
      command.operation,
      input,
      command.idempotencyKey,
      command._id,
    );
  },
});
async function principalForOwnerApproval(
  ctx: MutationCtx,
  owner: Doc<"users">,
  command: Doc<"forumPluginCommands">,
): Promise<ForumPluginPrincipal> {
  const connection = await ctx.db.get(
    "forumPluginConnections",
    command.connectionId,
  );
  if (
    !connection ||
    connection.ownerUserId !== owner._id ||
    connection.status !== "active"
  )
    throw new ConvexError("Connection is no longer active.");
  const [actor, credentialAgent] = await Promise.all([
    ctx.db.get("users", connection.actorUserId),
    ctx.db.get("agentIdentities", connection.credentialAgentIdentityId),
  ]);
  if (
    !actor ||
    !credentialAgent ||
    credentialAgent.ownerUserId !== owner._id ||
    credentialAgent.status !== "active" ||
    credentialAgent.keyVersion !== connection.keyVersion ||
    !credentialAgent.scopes.includes("forum") ||
    (connection.actorMode === "human"
      ? actor._id !== owner._id
      : actor._id !== credentialAgent.userId)
  )
    throw new ConvexError("Acting profile is no longer active.");
  const credential = await ctx.db.get("users", credentialAgent.userId);
  if (
    !credential ||
    credential.isAgent !== true ||
    credential.agentStatus !== "active" ||
    credential.agentKeyVersion !== connection.keyVersion ||
    !credential.agentScopes?.includes("forum")
  )
    throw new ConvexError("Credential is no longer active.");
  const principal: ForumPluginPrincipal = {
    owner,
    actor,
    credentialAgent,
    connection,
    capabilities: await effectivePluginCapabilities(
      ctx,
      owner,
      connection.capabilities,
      connection.capabilityCeiling,
    ),
    policyVersion: connection.policyVersion,
    authMode: "browser",
  };
  assertPrincipalActive(principal, credential);
  return principal;
}
export const rejectCommand = mutation({
  args: { commandId: v.id("forumPluginCommands") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const command = await ctx.db.get("forumPluginCommands", args.commandId);
    if (!command || command.ownerUserId !== owner._id)
      throw new ConvexError("Command not found.");
    if (command.status === "pending") {
      await ctx.db.patch("forumPluginCommands", command._id, {
        status: "rejected",
      });
      await ctx.scheduler.runAfter(0, expireCommandRef, {
        commandId: command._id,
      });
    }
    return null;
  },
});
export const authorizePluginAttachmentUpload = internalQuery({
  args: {
    ...proofArgs,
    connectionId: v.optional(v.id("forumPluginConnections")),
    expectedPolicyVersion: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (args.verifiedOAuthPrincipal)
      ctx = withVerifiedPluginOAuth(
        ctx,
        args.verifiedOAuthPrincipal,
        args.verifiedResource,
      );
    const principal = await checkedPrincipal(
      ctx,
      args.connectionId,
      "authorizeForumAttachmentUpload",
      args.verifiedResource,
    );
    if (
      args.expectedPolicyVersion !== undefined &&
      args.expectedPolicyVersion !== principal.policyVersion
    )
      throw new ConvexError("The acting profile or connection policy changed.");
    return await operations.authorizeForumAttachmentUpload.definition.handler(
      withForumPluginPrincipal(ctx, principal),
      {},
    );
  },
});
export const claimPluginAttachmentUpload = internalMutation({
  args: {
    ...proofArgs,
    connectionId: v.optional(v.id("forumPluginConnections")),
    expectedPolicyVersion: v.optional(v.number()),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    idempotencyKey: v.string(),
    contentHash: v.string(),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    if (args.verifiedOAuthPrincipal)
      ctx = withVerifiedPluginOAuth(
        ctx,
        args.verifiedOAuthPrincipal,
        args.verifiedResource,
      );
    if (!/^[a-f0-9]{64}$/.test(args.contentHash))
      throw new ConvexError("Invalid attachment digest.");
    const {
      connectionId,
      idempotencyKey,
      expectedPolicyVersion,
      verifiedResource,
      verifiedOAuthPrincipal: _verifiedOAuthPrincipal,
      ...input
    } = args;
    const result = await executeOperation(
      ctx,
      {
        connectionId,
        expectedPolicyVersion,
        operation: "claimStoredForumAttachmentUpload",
        args: input,
        idempotencyKey,
      },
      true,
      verifiedResource,
    );
    const command = result.commandId
      ? await ctx.db.get(
          "forumPluginCommands",
          result.commandId as Id<"forumPluginCommands">,
        )
      : null;
    const retainedStorageId = command
      ? (JSON.parse(command.argsJson).storageId as Id<"_storage">)
      : args.storageId;
    return { ...result, retainedStorageId };
  },
});

/** Staged bytes are private; terminal proposal cleanup never deletes a successfully claimed upload. */
export const cleanupStagedPluginUpload = internalMutation({
  args: { commandId: v.id("forumPluginCommands") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const command = await ctx.db.get("forumPluginCommands", args.commandId);
    if (!command || command.status === "completed") return null;
    if (command.status === "pending" && command.expiresAt > Date.now())
      return null;
    if (command.status === "pending")
      await ctx.db.patch("forumPluginCommands", command._id, {
        status: "expired",
      });
    if (command.operation !== "claimStoredForumAttachmentUpload") return null;
    const input = JSON.parse(command.argsJson);
    const storageId =
      typeof input.storageId === "string"
        ? ctx.db.system.normalizeId("_storage", input.storageId)
        : null;
    if (storageId) await ctx.storage.delete(storageId);
    return null;
  },
});

async function admitProposal(
  ctx: MutationCtx,
  principal: ForumPluginPrincipal,
) {
  const pending = await ctx.db
    .query("forumPluginCommands")
    .withIndex("by_ownerUserId_and_status_and_createdAt", (q) =>
      q.eq("ownerUserId", principal.owner._id).eq("status", "pending"),
    )
    .take(101);
  if (
    pending.length >= 100 ||
    pending.filter((row) => row.connectionId === principal.connection._id)
      .length >= 20
  )
    throw new ConvexError({
      code: "PLUGIN_PROPOSAL_LIMIT",
      message:
        "Review or reject queued proposals before adding more (20 per connection, 100 per owner).",
    });
  const owner = await proposalRateLimiter.limit(
    ctx,
    "forumPluginOwnerProposals",
    { key: String(principal.owner._id) },
  );
  const credential = await proposalRateLimiter.limit(
    ctx,
    "forumPluginCredentialProposals",
    { key: String(principal.credentialAgent._id) },
  );
  if (!owner.ok || !credential.ok)
    throw new ConvexError({
      code: "PLUGIN_PROPOSAL_RATE_LIMITED",
      message: "Proposal admission is temporarily rate limited.",
    });
}
