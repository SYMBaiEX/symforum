import { workosMetadata } from "@/lib/workos-discovery";
import { workosConfig } from "@/lib/workos-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const config = workosConfig(process.env);
    if (!config) {
      return Response.json(
        { error: "not_found", message: "OAuth is not enabled." },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    const issuerMetadataUrl = new URL(config.metadata);
    if (new URL(request.url).origin !== config.issuer) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: issuerMetadataUrl.href,
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const metadata = await workosMetadata();
    return Response.json(
      metadata,
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
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

export async function HEAD(request: Request) {
  const response = await GET(request);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
