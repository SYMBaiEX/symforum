export const OWNER_ADMIN_AI_TELEMETRY = {
  functionId: "admin.ai.owner-console",
  recordInputs: false,
  recordOutputs: false,
  includeRuntimeContext: {
    correlationId: true,
    surface: true,
  },
} as const;

export const OWNER_ADMIN_AI_STREAM_TIMEOUT = {
  totalMs: 240_000,
  stepMs: 90_000,
  firstChunkMs: 30_000,
  chunkMs: 45_000,
  toolMs: 30_000,
} as const;

/** Hard cap per streamed owner-console model step, reserved before generation. */
export const OWNER_ADMIN_AI_MAX_OUTPUT_TOKENS = 1_200;

export function ownerAdminAiRuntimeContext(correlationId: string) {
  return {
    correlationId,
    surface: "owner-console",
  } as const;
}
