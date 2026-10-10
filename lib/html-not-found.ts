const HTML_NOT_FOUND = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Page not found | SYMBaiEX</title>
  </head>
  <body style="margin:0;background:#fff;color:#181816;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65">
    <main style="box-sizing:border-box;max-width:72rem;margin:0 auto;padding:clamp(3rem,8vw,7rem) 1.5rem">
      <p style="margin:0;color:#66665f;font-size:.75rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase">404</p>
      <h1 style="margin:.75rem 0 0;font-size:clamp(2.75rem,7vw,4.5rem);font-weight:500;letter-spacing:-.055em;line-height:1.05">Page not found</h1>
      <p style="max-width:42rem;margin:1rem 0 0;color:#55554f;font-size:1rem">
        That page does not exist or has moved. Try the
        <a href="/blog" style="color:inherit;text-decoration:underline;text-underline-offset:.2em">blog</a>
        or
        <a href="/news" style="color:inherit;text-decoration:underline;text-underline-offset:.2em">news</a>
        index instead. Automated clients can recover through the public
        <a href="/developers" style="color:inherit;text-decoration:underline;text-underline-offset:.2em">developer guide</a>,
        <a href="/llms.txt" style="color:inherit;text-decoration:underline;text-underline-offset:.2em">agent index</a>,
        or
        <a href="/sitemap.xml" style="color:inherit;text-decoration:underline;text-underline-offset:.2em">XML sitemap</a>.
      </p>
      <p style="margin:1.5rem 0 0">
        <a href="/" style="display:inline-block;border-radius:.5rem;background:#181816;padding:.65rem 1rem;color:#fff;text-decoration:none">Back home</a>
      </p>
    </main>
  </body>
</html>`;

export function htmlNotFound(request: Pick<Request, "method">) {
  return new Response(request.method === "HEAD" ? null : HTML_NOT_FOUND, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=300",
      Vary: "Accept, Host",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
