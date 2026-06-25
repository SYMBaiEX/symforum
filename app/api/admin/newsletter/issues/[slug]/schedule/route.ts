import {
  AdminApiError,
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
    const scheduledAt = scheduledAtFromPayload(payload);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(
      adminApiRefs.scheduleNewsletterIssue,
      {
        tokenHash,
        slug,
        scheduledAt,
      },
    );
    return jsonOk(result);
  } catch (error) {
    return apiError(error);
  }
}

function scheduledAtFromPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    throw new AdminApiError(400, "Body must be a JSON object");
  }
  const value = "scheduledAt" in payload ? payload.scheduledAt : undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new AdminApiError(400, "scheduledAt is required");
}
