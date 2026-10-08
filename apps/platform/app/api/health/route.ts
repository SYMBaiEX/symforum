export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "symbaiex-web",
      runtime: process.env.NEXT_RUNTIME ?? "nodejs",
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 32) ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
