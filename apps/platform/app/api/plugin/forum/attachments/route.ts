import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import {
  FORUM_PLUGIN_FILE_BYTES,
  ForumUploadError,
  readForumPluginBytes,
  forumPluginUploadMetadata,
} from "@/lib/forum-plugin-upload";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  // Browser files are chosen in the visible forum composer, using its own session.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Upload from the forum composer." },
      { status: 403 },
    );
  try {
    const token =
      process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true"
        ? request.headers
            .get("authorization")
            ?.replace(/^Bearer\s+/i, "") ?? null
        : await convexAuthNextjsToken();
    if (!token)
      return Response.json(
        { error: "Sign in to upload forum attachments." },
        { status: 401 },
      );
    const site =
      process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    if (!site)
      return Response.json(
        { error: "Forum backend is unavailable." },
        { status: 503 },
      );
    const connection = request.headers.get("x-forum-plugin-connection");
    if (!connection || connection.length > 256)
      throw new ForumUploadError("Select an active forum connection.", 400);
    const policy = request.headers.get("x-forum-plugin-policy-version");
    if (!policy || !/^\d+$/.test(policy))
      throw new ForumUploadError("Refresh the selected forum connection.", 409);
    const metadata = forumPluginUploadMetadata(request);
    const bytes = await readForumPluginBytes(request, FORUM_PLUGIN_FILE_BYTES);
    if (!bytes.length) throw new ForumUploadError("Attachment is empty.", 400);
    const upstream = await fetch(
      `${site.replace(/\/$/, "")}/plugin/forum/attachments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": metadata.contentType,
          "X-Forum-Attachment-Filename": encodeURIComponent(metadata.filename),
          "X-Forum-Plugin-Connection": connection,
          "X-Forum-Plugin-Policy-Version": policy,
          "Idempotency-Key": metadata.idempotencyKey,
        },
        body: bytes.buffer as ArrayBuffer,
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
        cache: "no-store",
      },
    );
    return Response.json(await upstream.json(), {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ForumUploadError
            ? error.message
            : "Attachment upload failed. Retry with the same key.",
      },
      { status: error instanceof ForumUploadError ? error.status : 502 },
    );
  }
}
