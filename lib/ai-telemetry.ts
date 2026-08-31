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

export function ownerAdminAiRuntimeContext(correlationId: string) {
  return {
    correlationId,
    surface: "owner-console",
  } as const;
}
