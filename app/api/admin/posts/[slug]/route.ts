import {
  AdminApiError,
  adminApiRefs,
  adminConvexClient,
  apiError,
  jsonOk,
  normalizeApiPostPayload,
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
    const post = await convex.mutation(adminApiRefs.getPost, {
      tokenHash,
      slug,
    });
    if (post === null) {
      throw new AdminApiError(404, "Post not found");
    }
    return jsonOk({ post });
  } catch (error) {
    return apiError(error, request);
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
    const existing = await convex.mutation(adminApiRefs.getPost, {
      tokenHash,
      slug,
    });
    if (existing === null) {
      throw new AdminApiError(404, "Post not found");
    }
    const payload = await readJson(request);
    const post = {
      ...normalizeApiPostPayload(payload, existing),
      slug,
    };
    const savedPost = await convex.mutation(adminApiRefs.upsertPost, {
      tokenHash,
      post,
    });
    return jsonOk({ post: savedPost });
  } catch (error) {
    return apiError(error, request);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return PATCH(request, { params });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug: rawSlug } = await params;
    const slug = normalizeSlugParam(rawSlug);
    const tokenHash = tokenHashFromRequest(request);
    const convex = adminConvexClient();
    const result = await convex.mutation(adminApiRefs.deletePost, {
      tokenHash,
      slug,
    });
    return jsonOk(result);
  } catch (error) {
    return apiError(error, request);
  }
}
