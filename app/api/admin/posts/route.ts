import {
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeApiPostPayload,
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
    const posts = await convex.mutation(adminApiRefs.listPosts, { tokenHash });
    return jsonOk({ posts });
  } catch (error) {
    return apiError(error, request);
  }
}

export async function POST(request: Request) {
  try {
    const tokenHash = tokenHashFromRequest(request);
    const payload = await readJson(request);
    const post = normalizeApiPostPayload(payload);
    const convex = adminConvexClient();
    const savedPost = await convex.mutation(adminApiRefs.upsertPost, {
      tokenHash,
      post,
    });
    if (savedPost?.status === "published") {
      after(() =>
        notifyIndexNow([primarySiteUrl(`/blog/${encodeURIComponent(savedPost.slug)}`)], {
          context: {
            source: "post",
            action: "create",
            resourceId: savedPost.slug,
          },
        }),
      );
    }
    return jsonOk({ post: savedPost }, 201);
  } catch (error) {
    return apiError(error, request);
  }
}
