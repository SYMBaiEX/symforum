import { FORUM_PLUGIN_APP_SCRIPT, FORUM_PLUGIN_APP_CSS, FORUM_PLUGIN_ASSET_REVISION } from "@/lib/forum-plugin-app";

type Context = { params: Promise<{ revision: string; asset: string }> };

/** Public UI bytes only. Forum data and writes still travel through authorized MCP tools. */
export async function GET(_request: Request, context: Context) {
  const { revision, asset } = await context.params;
  const source = asset === "forum.js" ? FORUM_PLUGIN_APP_SCRIPT : asset === "forum.css" ? FORUM_PLUGIN_APP_CSS : null;
  if ((revision !== "current" && revision !== FORUM_PLUGIN_ASSET_REVISION) || source === null)
    return new Response("Unknown forum asset.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(source, {
    headers: {
      "Content-Type": asset === "forum.js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
      "Cache-Control": revision === "current" ? "no-store" : "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
