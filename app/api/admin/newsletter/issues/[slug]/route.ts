import {
  AdminApiError,
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeApiNewsletterIssuePayload,
  normalizeSlugParam,
  readJson,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeSlugParam(rawSlug);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const issue = await convex.mutation(adminApiRefs.getNewsletterIssue, {
      tokenHash,
      slug,
    });
    if (issue === null) {
      throw new AdminApiError(404, "Newsletter issue not found");
    }
    return jsonOk({ issue });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeSlugParam(rawSlug);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const existing = await convex.mutation(adminApiRefs.getNewsletterIssue, {
      tokenHash,
      slug,
    });
    const payload = await readJson(request);
    const issue = {
      ...normalizeApiNewsletterIssuePayload(payload, existing ?? undefined),
      slug,
    };
    const savedIssue = await convex.mutation(
      adminApiRefs.upsertNewsletterIssue,
      {
        tokenHash,
        issue,
      },
    );
    return jsonOk({ issue: savedIssue });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return PATCH(request, { params });
}
