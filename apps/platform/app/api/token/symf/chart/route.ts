import { SYMF_TOKEN } from "@/lib/symf-token";
import { terminalMarketResponse } from "@/lib/terminal-market-route";

export async function GET(request: Request) {
  return terminalMarketResponse(SYMF_TOKEN.mint, "chart", request, {
    pinnedSymf: true,
  });
}
