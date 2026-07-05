import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { ConvexHttpClient } from "convex/browser";

export async function getAuthenticatedServerConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!url) {
    return null;
  }

  const client = new ConvexHttpClient(url);
  const token = await convexAuthNextjsToken();
  if (token) {
    client.setAuth(token);
  }

  return client;
}
