import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeApiNewsletterIssuePayload,
  readJson,
  tokenHashFromRequest,
} from "@/lib/admin-api-server";
import { notifyIndexNow } from "@/lib/indexnow";
import { primarySiteUrl } from "@/lib/site-urls";
import { after } from "next/server";

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
    return apiError(error, request);
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
    if (savedIssue?.status === "sent") {
      after(() =>
        notifyIndexNow([
          primarySiteUrl(`/newsletter/${encodeURIComponent(savedIssue.slug)}`),
        ]),
      );
    }
    return jsonOk({ issue: savedIssue }, 201);
  } catch (error) {
    return apiError(error, request);
  }
}

export async function PATCH(request: Request) {
  return POST(request);
}
