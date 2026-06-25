import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeSlugParam,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeSlugParam(rawSlug);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(adminApiRefs.sendNewsletterIssueNow, {
      tokenHash,
      slug,
    });
    return jsonOk(result);
  } catch (error) {
    return apiError(error, request);
  }
}
