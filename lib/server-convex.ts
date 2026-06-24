import { ConvexHttpClient } from "convex/browser";

let cachedClient: {
  client: ConvexHttpClient;
  url: string;
} | null = null;

export function getServerConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!url) {
    return null;
  }

  if (cachedClient?.url !== url) {
    cachedClient = {
      client: new ConvexHttpClient(url),
      url,
    };
  }

  return cachedClient.client;
}
