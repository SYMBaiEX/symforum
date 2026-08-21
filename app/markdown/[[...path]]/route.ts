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
    return markdownNotFound();
  }

  const url = new URL(request.url);
  const rendered = await renderAiReadablePage({
    pathname,
    searchParams: url.searchParams,
    host: request.headers.get("host"),
  });
  if (!rendered) {
    return markdownNotFound();
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

function markdownNotFound() {
  return new Response(
    `# Not found

The requested public page does not exist or has no public Markdown representation.

- [Site index](https://www.symbaiex.com/llms.txt)
- [Developer guide](https://www.symbaiex.com/developers)
- [Agent API manifest](https://www.symbaiex.com/api/agent)
- [XML sitemap](https://www.symbaiex.com/sitemap.xml)
`,
    {
      status: 404,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, s-maxage=300",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
