import { primarySiteUrl } from "@/lib/site-urls";

export function GET() {
  return Response.redirect(primarySiteUrl("/developers/sandbox"), 308);
}

export const HEAD = GET;
