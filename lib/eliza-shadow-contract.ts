import { z } from "zod";

export const ELIZA_SHADOW_INPUT_MAX_BYTES = 100 * 1024;
export const ELIZA_SHADOW_PRIVATE_MAX_BYTES = 160 * 1024;
export const ELIZA_SHADOW_OUTPUT_MAX_BYTES = 128 * 1024;
export const ELIZA_SHADOW_MODEL = "~deepseek/deepseek-v4-flash-latest";
export const ELIZA_SHADOW_RUNTIME_VERSION = "1.7.2";
export const ELIZA_SHADOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const ELIZA_SHADOW_TIMEOUT_MS = 150_000;

export const elizaShadowKindSchema = z.enum(["suki-reply", "belle-newsletter"]);
export type ElizaShadowKind = z.infer<typeof elizaShadowKindSchema>;
const inputSchema = z
  .object({
    version: z.literal(1),
    kind: elizaShadowKindSchema,
    system: z.string().min(1).max(24_000),
    prompt: z.string().min(1).max(100_000),
    schema: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseBoundedShadowJson(
  json: string,
  maxBytes: number,
): unknown {
  if (new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new Error("shadow_payload_too_large");
  }
  return JSON.parse(json) as unknown;
}

export function parseShadowInput(json: string, kind?: ElizaShadowKind) {
  const input = inputSchema.parse(
    parseBoundedShadowJson(json, ELIZA_SHADOW_INPUT_MAX_BYTES),
  );
  if (kind !== undefined && input.kind !== kind)
    throw new Error("shadow_kind_mismatch");
  return input;
}

export function shadowWorkerOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function shadowBudgetMicroUsd(value: string | undefined) {
  const usd = Number(value ?? "1");
  // A typo must stop spend, never silently remove the cap.
  return Number.isFinite(usd) && usd > 0 && usd <= 5
    ? Math.floor(usd * 1_000_000)
    : 0;
}

export async function shadowInputHash(json: string) {
  const bytes = new TextEncoder().encode(json);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const shadowWorkerResultSchema = z
  .object({
    version: z.literal(1),
    jobId: z.string().min(1).max(128),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    output: z.record(z.string(), z.unknown()),
    model: z.literal(ELIZA_SHADOW_MODEL),
    servedModel: z.string().min(1).max(200),
    inputTokens: z.number().int().nonnegative().max(150_000),
    outputTokens: z.number().int().nonnegative().max(10_000),
    providerCostMicroUsd: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000)
      .optional(),
    durationMs: z.number().int().nonnegative().max(150_000),
    runtimeVersion: z.literal(ELIZA_SHADOW_RUNTIME_VERSION),
  })
  .strict();
