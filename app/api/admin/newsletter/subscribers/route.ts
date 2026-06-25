import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const subscribers = await convex.mutation(
      adminApiRefs.listNewsletterSubscribers,
      { tokenHash },
    );
    return jsonOk({ subscribers });
  } catch (error) {
    return apiError(error, request);
  }
}
