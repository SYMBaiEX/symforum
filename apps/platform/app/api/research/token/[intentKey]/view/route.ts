import { researchReportViewHttp } from "@/lib/forum-research-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ intentKey: string }> },
) {
  return researchReportViewHttp(request, (await context.params).intentKey);
}
// Explicit refusals carry the same private security headers and never read data.
export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
