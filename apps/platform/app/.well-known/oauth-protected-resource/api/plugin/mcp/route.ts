
import { PRIMARY_SITE_URL } from "../../../../../../../../lib/site-urls";
import { FORUM_PLUGIN_RESOURCE } from "@/lib/forum-plugin-contract";
import { workosPluginConfig } from "@/lib/workos-config";

export const dynamic = "force-dynamic";
export function GET() {
  try {
    const config = workosPluginConfig(process.env);
    return Response.json(
      {
        resource: FORUM_PLUGIN_RESOURCE,
        scopes_supported: ["openid", "offline_access"],
        bearer_methods_supported: ["header"],
        resource_documentation:
          PRIMARY_SITE_URL + "/developers/forum-plugin",
        ...(config ? { authorization_servers: [config.issuer] } : {}),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Forum plugin OAuth configuration is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export function HEAD() {
  const response = GET();
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
