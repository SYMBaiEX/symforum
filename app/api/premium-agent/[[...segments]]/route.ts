import {
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
function unavailable(request: Request) {
  return premiumAgentApiUnavailable(request);
}

export const GET = unavailable;
export const HEAD = unavailable;
export const POST = unavailable;
export const PUT = unavailable;
export const PATCH = unavailable;
export const DELETE = unavailable;
export const OPTIONS = unavailable;
