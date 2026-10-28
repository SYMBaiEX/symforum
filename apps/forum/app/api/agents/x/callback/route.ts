import { xCallbackDestination } from "@/lib/x-agent-policy";

export function GET(request: Request) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: xCallbackDestination(new URL(request.url)).toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
