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
    const entityType = entityTypeParam(
      request.nextUrl.searchParams.get("entityType"),
    );
    const entityId = request.nextUrl.searchParams.get("entityId") ?? undefined;
    const convex = adminConvexClient();
    const [comments, interactions] = await Promise.all([
      convex.mutation(adminApiRefs.listComments, {
        tokenHash,
        entityType,
        entityId,
      }),
      convex.mutation(adminApiRefs.listInteractions, {
        tokenHash,
        entityType,
        entityId,
      }),
    ]);
    return jsonOk({ comments, interactions });
  } catch (error) {
    return apiError(error, request);
  }
}

function entityTypeParam(value: string | null) {
  return value === "post" || value === "hnStory" ? value : undefined;
}
