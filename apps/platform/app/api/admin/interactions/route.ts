import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tokenHash = tokenHashFromRequest(request);
    const entityTypeParamValue = request.nextUrl.searchParams.get("entityType");
    const commentEntityType = commentEntityTypeParam(entityTypeParamValue);
    const interactionEntityType =
      entityTypeParamValue === "post" || entityTypeParamValue === "hnStory"
        ? entityTypeParamValue
        : undefined;
    const entityId = request.nextUrl.searchParams.get("entityId") ?? undefined;
    const convex = adminConvexClient();
    const [comments, interactions] = await Promise.all([
      convex.mutation(adminApiRefs.listComments, {
        tokenHash,
        entityType: commentEntityType,
        entityId,
      }),
      convex.mutation(adminApiRefs.listInteractions, {
        tokenHash,
        entityType: interactionEntityType,
        entityId,
      }),
    ]);
    return jsonOk({ comments, interactions });
  } catch (error) {
    return apiError(error, request);
  }
}

function commentEntityTypeParam(value: string | null) {
  return value === "post" ||
    value === "hnStory" ||
    value === "portfolioProject"
    ? value
    : undefined;
}
