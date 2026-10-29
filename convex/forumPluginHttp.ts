import { installationWebOrigins } from "../lib/installation-config";
import { installation } from "./installation";

import { PRIMARY_SITE_URL, FORUM_SITE_URL } from "../lib/site-urls";
import type { HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyForumPluginOAuth } from "./forumPluginToken";
import {
  getForumPluginOperation,
  validateForumPluginArguments,
} from "../lib/forum-plugin-catalog";
import {
  FORUM_PLUGIN_METADATA_URL,
  FORUM_PLUGIN_RESOURCE,
} from "../lib/forum-plugin-contract";
import {
  FORUM_PLUGIN_FILE_BYTES,
  ForumUploadError,
  readForumPluginBytes,
  forumPluginUploadMetadata,
} from "../lib/forum-plugin-upload";

const origins = new Set([
  ...installationWebOrigins(installation).filter(origin => origin.startsWith("https:")),
  "https://chatgpt.com",
  "https://chat.openai.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://forum.localhost:3000",
]);
function headers(request: Request) {
  const result = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-forum-attachment-filename, x-forum-plugin-connection, x-forum-plugin-policy-version, idempotency-key",
    "Access-Control-Expose-Headers": "www-authenticate, retry-after",
  });
  const origin = request.headers.get("origin");
  if (origin && origins.has(origin))
    result.set("Access-Control-Allow-Origin", origin);
  return result;
}
function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origins.has(origin);
}
function json(request: Request, value: unknown, status = 200) {
  return Response.json(value, { status, headers: headers(request) });
}
export function forumPluginHttpError(request: Request, error: unknown) {
  let code = "PLUGIN_REQUEST_FAILED",
    message = "The forum request could not be completed.",
    status = 400;
  const diagnostics: Record<string, unknown> = {};
  if (error instanceof ForumUploadError) {
    message = error.message;
    status = error.status;
  } else if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === "string") message = data;
    else if (data && typeof data === "object") {
      const object = data as Record<string, unknown>;
      if (typeof object.code === "string") code = object.code;
      if (typeof object.message === "string") message = object.message;
      if (code === "AGENT_QUOTA_EXCEEDED" || code === "FORUM_RATE_LIMITED") {
        const reason = object.quotaReason ?? object.reason;
        if (
          typeof reason === "string" &&
          ["hard-cap", "agent-limit", "request-limit", "rate-limited"].includes(
            reason,
          )
        )
          diagnostics.quotaReason = reason;
        if (
          typeof object.retryAfter === "number" &&
          Number.isFinite(object.retryAfter) &&
          object.retryAfter > 0 &&
          object.retryAfter <= 86_400_000
        )
          diagnostics.retryAfter = object.retryAfter;
        if (
          typeof object.resetsAt === "number" &&
          Number.isSafeInteger(object.resetsAt) &&
          object.resetsAt > 0 &&
          object.resetsAt <= 8_640_000_000_000_000
        )
          diagnostics.resetsAt = object.resetsAt;
        if (
          object.quota &&
          typeof object.quota === "object" &&
          !Array.isArray(object.quota)
        ) {
          const quota = object.quota as Record<string, unknown>;
          const safe: Record<string, unknown> = {};
          for (const key of [
            "agentUsedUnits",
            "agentLimitUnits",
            "ownerUsedUnits",
            "ownerLimitUnits",
            "remainingUnits",
          ])
            if (
              typeof quota[key] === "number" &&
              Number.isSafeInteger(quota[key]) &&
              quota[key] >= 0 &&
              quota[key] <= 1_000_000_000
            )
              safe[key] = quota[key];
          if (
            typeof quota.resetsAt === "number" &&
            Number.isSafeInteger(quota.resetsAt) &&
            quota.resetsAt > 0 &&
            quota.resetsAt <= 8_640_000_000_000_000
          )
            safe.resetsAt = quota.resetsAt;
          if (quota.settingsUrl === PRIMARY_SITE_URL + "/developer")
            safe.settingsUrl = quota.settingsUrl;
          if (Object.keys(safe).length) diagnostics.quota = safe;
        }
      }
    }
    if (/AUTH_REQUIRED|INVALID_TOKEN|CONNECTION|CREDENTIAL/.test(code))
      status = 401;
    else if (/CAPABILITY|FORBIDDEN|RESTRICTED|DENIED/.test(code)) status = 403;
    else if (/QUOTA|RATE_LIMIT/.test(code)) status = 429;
    else if (/IDEMPOTENCY_CONFLICT/.test(code)) status = 409;
  }
  const response = json(
    request,
    { code, error: message, ...diagnostics },
    status,
  );
  if (status === 401 || status === 403)
    response.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${FORUM_PLUGIN_METADATA_URL}", error="${status === 401 ? "invalid_token" : "insufficient_scope"}"`,
    );
  if (typeof diagnostics.retryAfter === "number")
    response.headers.set(
      "Retry-After",
      String(Math.max(1, Math.ceil(diagnostics.retryAfter / 1_000))),
    );
  return response;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function addForumPluginRoutes(http: HttpRouter) {
  for (const path of ["/plugin/forum", "/plugin/forum/attachments"])
    http.route({
      path,
      method: "OPTIONS",
      handler: httpAction(
        async (_ctx, request) =>
          new Response(null, {
            status: originAllowed(request) ? 204 : 403,
            headers: headers(request),
          }),
      ),
    });
  http.route({
    path: "/plugin/forum",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (!originAllowed(request))
        return json(request, { error: "Origin is not allowed." }, 403);
      try {
        if (
          !/^application\/json(?:;|$)/i.test(
            request.headers.get("content-type") ?? "",
          )
        )
          throw new ForumUploadError(
            "Content-Type must be application/json.",
            415,
          );
        const body: unknown = JSON.parse(
          new TextDecoder().decode(
            await readForumPluginBytes(request, 256 * 1024),
          ),
        );
        if (
          !record(body) ||
          typeof body.operation !== "string" ||
          !record(body.args) ||
          Object.keys(body).some(
            (k) =>
              ![
                "operation",
                "args",
                "idempotencyKey",
                "expectedPolicyVersion",
              ].includes(k),
          )
        )
          throw new ForumUploadError("Invalid forum command.", 400);
        const operation = getForumPluginOperation(body.operation);
        if (!operation || operation.operation === "uploadAttachments")
          throw new ForumUploadError("Unknown forum operation.", 400);
        const input = operation.readOnly
          ? body.args
          : {
              ...body.args,
              idempotencyKey: body.idempotencyKey,
              expectedPolicyVersion: body.expectedPolicyVersion,
            };
        const invalid = validateForumPluginArguments(operation, input);
        if (invalid) throw new ForumUploadError(invalid, 400);
        if (request.headers.has("authorization"))
          throw new ConvexError({
            code: "PLUGIN_INVALID_TOKEN",
            message: "Use the resource-bound forum MCP relay.",
          });
        const token = request.headers.get("x-symbaiex-forum-oauth");
        const proof = token
          ? ({
              verifiedResource: FORUM_PLUGIN_RESOURCE,
              verifiedOAuthPrincipal: await verifyForumPluginOAuth(token),
            } as const)
          : null;
        if (!proof && !operation.publicRead)
          throw new ConvexError({
            code: "PLUGIN_AUTH_REQUIRED",
            message: "Connect your forum profile.",
          });
        if (operation.operation === "status") {
          const state = await ctx.runQuery(internal.forumPlugin.status, {
            ...proof!,
            now: Date.now(),
          });
          return json(request, {
            status: "completed",
            actingAs: state.actingAs,
            data: state,
          });
        }
        if (operation.readOnly)
          return json(
            request,
            proof
              ? await ctx.runMutation(internal.forumPlugin.remoteRead, {
                  operation: operation.operation,
                  args: body.args,
                  idempotencyKey: crypto.randomUUID(),
                  ...proof,
                })
              : await ctx.runQuery(internal.forumPlugin.publicRead, {
                  operation: operation.operation,
                  args: body.args,
                }),
          );
        return json(
          request,
          await ctx.runMutation(internal.forumPlugin.remoteExecute, {
            operation: operation.operation,
            args: body.args,
            idempotencyKey: body.idempotencyKey as string,
            expectedPolicyVersion: body.expectedPolicyVersion as number,
            ...proof!,
          }),
        );
      } catch (error) {
        return forumPluginHttpError(request, error);
      }
    }),
  });
  http.route({
    path: "/plugin/forum/attachments",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      if (!originAllowed(request))
        return json(request, { error: "Origin is not allowed." }, 403);
      let stored: Id<"_storage"> | undefined;
      try {
        const connection = request.headers.get("x-forum-plugin-connection");
        const token = request.headers.get("x-symbaiex-forum-oauth");
        if (connection) {
          if (token || !(await ctx.auth.getUserIdentity()))
            throw new ConvexError({
              code: "PLUGIN_AUTH_REQUIRED",
              message: "Use your signed-in human forum session.",
            });
        } else if (!token || request.headers.has("authorization")) {
          throw new ConvexError({
            code: "PLUGIN_AUTH_REQUIRED",
            message: "Connect your forum profile.",
          });
        }
        const oauth = token ? await verifyForumPluginOAuth(token) : undefined;
        const policy = request.headers.get("x-forum-plugin-policy-version");
        if (
          !policy ||
          !/^\d+$/.test(policy) ||
          !Number.isSafeInteger(Number(policy)) ||
          Number(policy) < 1
        )
          throw new ForumUploadError(
            "Refresh the selected forum connection.",
            409,
          );
        const args = {
          verifiedResource: FORUM_PLUGIN_RESOURCE,
          ...(connection
            ? { connectionId: connection as Id<"forumPluginConnections"> }
            : {}),
          ...(oauth ? { verifiedOAuthPrincipal: oauth } : {}),
          expectedPolicyVersion: Number(policy),
        } as const;
        const metadata = forumPluginUploadMetadata(request);
        await ctx.runQuery(
          internal.forumPlugin.authorizePluginAttachmentUpload,
          args,
        );
        const bytes = await readForumPluginBytes(
          request,
          FORUM_PLUGIN_FILE_BYTES,
        );
        if (bytes.length === 0)
          throw new ForumUploadError("Attachment is empty.", 400);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          bytes.buffer as ArrayBuffer,
        );
        const contentHash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        stored = await ctx.storage.store(
          new Blob([bytes.buffer as ArrayBuffer], {
            type: metadata.contentType,
          }),
        );
        const result = await ctx.runMutation(
          internal.forumPlugin.claimPluginAttachmentUpload,
          { ...args, ...metadata, storageId: stored, contentHash },
        );
        // A retried upload keeps the original receipt and discards the redundant bytes.
        if (result.retainedStorageId !== stored)
          await ctx.storage.delete(stored);
        const { retainedStorageId: _retained, ...receipt } = result;
        return json(request, receipt);
      } catch (error) {
        if (stored) await ctx.storage.delete(stored);
        return forumPluginHttpError(request, error);
      }
    }),
  });
}
