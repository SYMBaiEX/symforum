import { terminalMarketResponse } from "@/lib/terminal-market-route";

export async function GET(
  request: Request,
  context: { params: Promise<{ mint: string }> },
) {
  return terminalMarketResponse((await context.params).mint, "chart", request);
}
