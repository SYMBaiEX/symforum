export type OwnerConsoleSettlementRoute = "free" | "paid";

/** Stable, purpose-bound payload for server-attested owner-console settlement. */
export function ownerConsoleSettlementPayload(args: {
  reservationKey: string;
  runKey: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  servedRoute: OwnerConsoleSettlementRoute;
  servedModel: string;
}) {
  return [
    "SYMBIEX_OWNER_CONSOLE_AI_SETTLEMENT_V1",
    args.reservationKey,
    args.runKey,
    String(args.inputTokens),
    String(args.outputTokens),
    String(args.durationMs),
    args.servedRoute,
    args.servedModel,
  ].join("\n");
}
