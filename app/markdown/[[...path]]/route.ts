import {
  isPrivateAiReadablePath,
  normalizePathname,
  renderAiReadablePage,
} from "@/lib/ai-readable";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const pathname = normalizePathname(`/${(path ?? []).join("/")}`);
  if (isPrivateAiReadablePath(pathname)) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const rendered = await renderAiReadablePage({
    pathname,
    searchParams: url.searchParams,
    host: request.headers.get("host"),
  });
  if (!rendered) {
    return new Response("Not found\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, follow",
    Vary: "Accept, Host",
    Link: `<${rendered.canonical}>; rel="canonical"; type="text/html"`,
  });
  if (rendered.modified) {
    headers.set("Last-Modified", new Date(rendered.modified).toUTCString());
  }
  return new Response(rendered.markdown, { headers });
}
