import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { readLimitedText } from "@x402/core/http";
import { z } from "zod";
import { RESEARCH_FACILITATOR } from "./forum-research";

const verifySchema = z.object({
  isValid: z.boolean(),
  payer: z.string().max(64).optional(),
});
const settleSchema = z.object({
  success: z.boolean(),
  payer: z.string().max(64).optional(),
  transaction: z.string().max(128),
  network: z.string().max(80),
  amount: z.string().max(30).optional(),
});
/** One pinned, bounded attempt. Never follows a 307/308 with signed payment authority. */
async function request(
  operation: "verify" | "settle",
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fetcher: typeof fetch,
) {
  const response = await fetcher(`${RESEARCH_FACILITATOR}/${operation}`, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: payload.x402Version,
      paymentPayload: payload,
      paymentRequirements: requirements,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || response.redirected) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Facilitator result requires protected verification.");
  }
  const value: unknown = JSON.parse(await readLimitedText(response, 32_768));
  return value;
}
export async function verifyResearchPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fetcher: typeof fetch = fetch,
): Promise<VerifyResponse> {
  return verifySchema.parse(
    await request("verify", payload, requirements, fetcher),
  );
}
export async function settleResearchPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fetcher: typeof fetch = fetch,
): Promise<SettleResponse> {
  const result = settleSchema.parse(
    await request("settle", payload, requirements, fetcher),
  );
  return { ...result, network: result.network as SettleResponse["network"] };
}
