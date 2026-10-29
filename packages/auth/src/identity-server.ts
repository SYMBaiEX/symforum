import "server-only";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

function identityServer() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const convexSiteUrl =
    process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!convexUrl || !convexSiteUrl)
    throw new Error("Identity backend is not configured.");
  return convexBetterAuthNextJs({
    convexUrl,
    convexSiteUrl,
    basePath: "/api/identity",
  });
}
export async function identityGET(request: Request) {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED !== "true")
    return new Response(null, { status: 404 });
  return identityServer().handler.GET(request);
}
export async function identityPOST(request: Request) {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED !== "true")
    return new Response(null, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > 32_768)
    return new Response(null, { status: 413 });
  return identityServer().handler.POST(request);
}
export async function identityToken() {
  return identityServer().getToken();
}
