import { SYMF_TOKEN } from "@/lib/symf-token";
import { terminalMarketResponse } from "@/lib/terminal-market-route";

/** The durable server cache owns every provider read and its admission. */
export function GET(request: Request) {
  return terminalMarketResponse(SYMF_TOKEN.mint, "market", request, {
    pinnedSymf: true,
  });
}
