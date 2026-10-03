/** Shared byte limits for the browser relay and Convex upload endpoint. */
export const FORUM_PLUGIN_FILE_BYTES = 5 * 1024 * 1024;
export const FORUM_PLUGIN_FILE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
]);
export class ForumUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function readForumPluginBytes(
  request: Request,
  maximum: number,
): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new ForumUploadError("Request body exceeds the allowed size.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ForumUploadError("Request body exceeds the allowed size.", 413);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export function forumPluginUploadMetadata(request: Request) {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!FORUM_PLUGIN_FILE_TYPES.has(contentType))
    throw new ForumUploadError("This file type is not allowed.", 415);
  let filename: string;
  try {
    filename = decodeURIComponent(
      request.headers.get("x-forum-attachment-filename") ?? "",
    ).trim();
  } catch {
    throw new ForumUploadError("Invalid attachment filename.", 400);
  }
  if (
    !filename ||
    filename.length > 256 ||
    /[\u0000-\u001f\u007f/\\]/.test(filename)
  )
    throw new ForumUploadError(
      "Use a valid attachment filename of at most 256 characters.",
      400,
    );
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey))
    throw new ForumUploadError("A stable idempotency key is required.", 400);
  return { contentType, filename, idempotencyKey };
}
