import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeSlugParam,
  readJson,
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
    const payload = await readJson(request);
    const to =
      typeof payload === "object" &&
      payload !== null &&
      "to" in payload &&
      typeof payload.to === "string"
        ? payload.to
        : undefined;
    if (!to?.trim()) throw Error("A newsletter test recipient is required.");
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(
      adminApiRefs.sendNewsletterIssueTest,
      {
        tokenHash,
        slug,
        to,
      },
    );
    return jsonOk(result);
  } catch (error) {
    return apiError(error, request);
  }
}
