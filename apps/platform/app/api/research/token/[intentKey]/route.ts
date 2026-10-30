import { researchResourceHttp } from "@/lib/forum-research-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ intentKey: string }> },
) {
  return researchResourceHttp(request, (await context.params).intentKey);
}
