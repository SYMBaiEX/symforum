import { workosMetadata } from "@/lib/workos-discovery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const metadata = await workosMetadata();
    return Response.json(
      metadata ?? { error: "not_found", message: "OAuth is not enabled." },
      {
        status: metadata ? 200 : 404,
        headers: {
          "Cache-Control": metadata
            ? "public, max-age=60, s-maxage=300"
            : "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error: "temporarily_unavailable",
        message: "Authorization discovery is unavailable. Retry later.",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Retry-After": "30",
        },
      },
    );
  }
}

export async function HEAD() {
  const response = await GET();
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
