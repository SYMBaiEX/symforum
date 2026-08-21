import { AGENT_SKILLS_INDEX } from "@/lib/agent-discovery";

export const dynamic = "force-static";

export function GET() {
  return Response.json(AGENT_SKILLS_INDEX, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "application/agent-skills+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const HEAD = GET;
