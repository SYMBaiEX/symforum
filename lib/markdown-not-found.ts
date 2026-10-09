const MARKDOWN_NOT_FOUND = `# Not found

The requested public page does not exist or has no public Markdown representation.

- [Site index](https://www.symbaiex.com/llms.txt)
- [Developer guide](https://www.symbaiex.com/developers)
- [Agent API manifest](https://www.symbaiex.com/api/agent)
- [XML sitemap](https://www.symbaiex.com/sitemap.xml)
`;

export function markdownNotFound(request: Pick<Request, "method">) {
  return new Response(request.method === "HEAD" ? null : MARKDOWN_NOT_FOUND, {
    status: 404,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, s-maxage=300",
      Vary: "Accept, Host",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
