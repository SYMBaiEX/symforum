import {
  AdminApiError,
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";
import { BodyReadError, readBoundedBody } from "@/lib/bounded-body";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

// POST raw image bytes (Content-Type: image/*) with a bearer token. Stores the
// file in Convex storage and returns a public URL usable as a post's imageUrl.
export async function POST(request: Request) {
  try {
    const tokenHash = tokenHashFromRequest(request);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new AdminApiError(415, "Content-Type must be an image/* type");
    }

    const bytes = await readBoundedBody(request, MAX_IMAGE_BYTES);
    if (bytes.byteLength === 0) {
      throw new AdminApiError(400, "Empty image body");
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new AdminApiError(413, "Image is too large (max 8 MB)");
    }

    const convex = adminConvexClient();

    // 1) Get a one-time Convex upload URL.
    const uploadUrl = await convex.mutation(adminApiRefs.generateUploadUrl, {
      tokenHash,
    });

    // 2) POST the bytes to it; Convex returns { storageId }.
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes.buffer as ArrayBuffer,
    });
    if (!uploadResponse.ok) {
      throw new AdminApiError(502, "Failed to store image in Convex");
    }
    const { storageId } = (await uploadResponse.json()) as {
      storageId: string;
    };
    if (!storageId) {
      throw new AdminApiError(502, "Convex did not return a storage id");
    }

    // 3) Resolve the public URL for the stored file.
    const url = await convex.mutation(adminApiRefs.resolveStorageUrl, {
      tokenHash,
      storageId,
    });
    if (!url) {
      throw new AdminApiError(500, "Could not resolve the uploaded image URL");
    }

    return jsonOk({ url });
  } catch (error) {
    if (error instanceof BodyReadError)
      return apiError(new AdminApiError(error.status, error.message), request);
    return apiError(error, request);
  }
}
