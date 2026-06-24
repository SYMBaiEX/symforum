import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeConvexIdParam,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ commentId: string }> },
) {
  try {
    const { commentId: rawCommentId } = await params;
    const commentId = normalizeConvexIdParam(rawCommentId);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(adminApiRefs.deleteComment, {
      tokenHash,
      commentId,
    });
    return jsonOk(result);
  } catch (error) {
    return apiError(error);
  }
}
