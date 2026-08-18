import type { AgentEventEnvelope } from "./agent-event-contract";

export type UsageBudgetEvent =
  | AgentEventEnvelope<"evidence.usage.threshold_reached">
  | AgentEventEnvelope<"evidence.usage.budget_reached">;

export type EntitlementStatusEvent = AgentEventEnvelope<
  "evidence.entitlement.status_changed"
>;

/** Stable non-reversible key material for event idempotency; never sent in data. */
export function stableEventScope(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function usageEvent(
  type: UsageBudgetEvent["type"],
  id: string,
  occurredAt: number,
  data: UsageBudgetEvent["data"],
) {
  return { id, type, occurredAt, data } as UsageBudgetEvent;
}

export function entitlementStatusEvent(
  id: string,
  occurredAt: number,
  data: EntitlementStatusEvent["data"],
) {
  return {
    id,
    type: "evidence.entitlement.status_changed" as const,
    occurredAt,
    data,
  } satisfies EntitlementStatusEvent;
}
