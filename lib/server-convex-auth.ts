import "server-only";

import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { identityToken } from "@symbaiex/auth/identity-server";

export async function getAuthenticatedServerConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!url) {
    return null;
  }

  const client = new ConvexHttpClient(url);
  const token = process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true" ? await identityToken() : await convexAuthNextjsToken();
  if (token) {
    client.setAuth(token);
  }

  return client;
}
