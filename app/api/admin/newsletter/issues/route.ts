import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeApiNewsletterIssuePayload,
  readJson,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const issues = await convex.mutation(adminApiRefs.listNewsletterIssues, {
      tokenHash,
    });
    return jsonOk({ issues });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tokenHash = tokenHashFromRequest(request);
    const payload = await readJson(request);
    const issue = normalizeApiNewsletterIssuePayload(payload);
    const convex = adminConvexClient();
    const savedIssue = await convex.mutation(
      adminApiRefs.upsertNewsletterIssue,
      {
        tokenHash,
        issue,
      },
    );
    return jsonOk({ issue: savedIssue }, 201);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
