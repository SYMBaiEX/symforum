import { acceptsMediaType } from "@/lib/accepts-media-type";
import { htmlNotFound } from "@/lib/html-not-found";
import { markdownNotFound } from "@/lib/markdown-not-found";

function handleUnmatchedRoute(request: Request) {
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    acceptsMediaType(request.headers.get("accept"), "text/markdown")
  ) {
    return markdownNotFound(request);
  }

  return htmlNotFound(request);
}

export function GET(request: Request) {
  return handleUnmatchedRoute(request);
}

export function HEAD(request: Request) {
  return handleUnmatchedRoute(request);
}

export function POST(request: Request) {
  return handleUnmatchedRoute(request);
}

export function PUT(request: Request) {
  return handleUnmatchedRoute(request);
}

export function PATCH(request: Request) {
  return handleUnmatchedRoute(request);
}

export function DELETE(request: Request) {
  return handleUnmatchedRoute(request);
}

export function OPTIONS(request: Request) {
  return handleUnmatchedRoute(request);
}
