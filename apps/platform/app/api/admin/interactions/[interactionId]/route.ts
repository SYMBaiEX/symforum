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
  { params }: { params: Promise<{ interactionId: string }> },
) {
  try {
    const { interactionId: rawInteractionId } = await params;
    const interactionId = normalizeConvexIdParam(rawInteractionId);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(adminApiRefs.deleteInteraction, {
      tokenHash,
      interactionId,
    });
    return jsonOk(result);
  } catch (error) {
    return apiError(error, request);
  }
}
