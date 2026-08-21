export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN?.trim() ?? "";
  if (
    token.length < 8 ||
    token.length > 1024 ||
    /[\s\u0000-\u001f\u007f]/.test(token)
  ) {
    return new Response(null, { status: 404, headers: challengeHeaders() });
  }
  return new Response(token, { status: 200, headers: challengeHeaders() });
}

function challengeHeaders() {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}
