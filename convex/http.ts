import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { resend } from "./resendClient";

const http = httpRouter();
const FORUM_ATTACHMENT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
]);

auth.addHttpRoutes(http);

http.route({
  path: "/forum-attachment-upload",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, {
      status: 204,
      headers: forumAttachmentUploadCorsHeaders(request),
    });
  }),
});

http.route({
  path: "/forum-attachment-upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const corsHeaders = forumAttachmentUploadCorsHeaders(request);

    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) {
        return forumAttachmentUploadJson(
          { error: "Sign in to upload forum attachments." },
          401,
          corsHeaders,
        );
      }

      const contentType = request.headers.get("content-type") ?? "";
      if (!FORUM_ATTACHMENT_ALLOWED_CONTENT_TYPES.has(contentType)) {
        return forumAttachmentUploadJson(
          { error: "That attachment type is not allowed." },
          415,
          corsHeaders,
        );
      }

      const encodedFilename =
        request.headers.get("x-forum-attachment-filename") ?? "";
      const filename = safeDecodeForumAttachmentFilename(encodedFilename);
      if (filename.trim().length === 0) {
        return forumAttachmentUploadJson(
          { error: "Attachment filename is required." },
          400,
          corsHeaders,
        );
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) {
        return forumAttachmentUploadJson(
          { error: "Attachment file is empty." },
          400,
          corsHeaders,
        );
      }
      if (bytes.byteLength > FORUM_ATTACHMENT_MAX_FILE_BYTES) {
        return forumAttachmentUploadJson(
          { error: "Attachments must be 5 MB or smaller." },
          413,
          corsHeaders,
        );
      }

      await ctx.runQuery(internal.forum.authorizeForumAttachmentUpload, {});
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: contentType }),
      );
      const attachment = await ctx.runMutation(
        internal.forum.claimStoredForumAttachmentUpload,
        {
          storageId,
          filename,
          contentType,
        },
      );

      return forumAttachmentUploadJson(attachment, 200, corsHeaders);
    } catch (error) {
      return forumAttachmentUploadJson(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not upload forum attachment.",
        },
        400,
        corsHeaders,
      );
    }
  }),
});

http.route({
  path: "/resend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return await resend.handleResendEventWebhook(ctx, request);
  }),
});

export default http;

function forumAttachmentUploadCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-forum-attachment-filename",
    "Access-Control-Max-Age": "86400",
  });
  if (origin !== null) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function forumAttachmentUploadJson(
  payload: unknown,
  status: number,
  headers: Headers,
) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

function safeDecodeForumAttachmentFilename(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
