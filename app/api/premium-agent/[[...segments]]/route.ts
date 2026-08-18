import {
  premiumAgentApiHeaders,
  premiumAgentApiState,
  premiumAgentApiUnavailable,
} from "@/lib/premium-agent-api-boundary";

export const dynamic = "force-dynamic";

/**
 * Reserved for agent-api.symbaiex.com once the hostname is provisioned.
 *
 * It is intentionally inert: no public-site route, Convex origin, payment
 * provider, entitlement, or usage ledger is exposed until the complete
 * authenticated implementation is enabled.
 */
export function GET(request: Request) {
  return premiumAgentApiUnavailable(request);
}

export function POST(request: Request) {
  return premiumAgentApiUnavailable(request);
}

export function OPTIONS(request: Request) {
  return premiumAgentApiState(request) === "ready"
    ? new Response(null, { status: 204, headers: premiumAgentApiHeaders(request) })
    : premiumAgentApiUnavailable(request);
}
