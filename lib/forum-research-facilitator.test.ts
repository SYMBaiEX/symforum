import { expect, test, vi } from "vitest";
import {
  settleResearchPayment,
  verifyResearchPayment,
} from "./forum-research-facilitator";
import {
  RESEARCH_FACILITATOR,
  RESEARCH_NETWORK,
  researchRequirements,
  researchResource,
} from "./forum-research";
const requirements = researchRequirements(
  "a".repeat(64),
  "So11111111111111111111111111111111111111112",
);
const payload = {
  x402Version: 2,
  accepted: requirements,
  resource: { url: researchResource("a".repeat(64)) },
  payload: { transaction: "AAAA" },
};
test.each([301, 302, 303, 307, 308, 429, 500, 503])(
  "a %i does not redirect or retry signed settlement",
  async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status,
          headers: { Location: "https://untrusted.example/settle" },
        }),
    );
    await expect(
      settleResearchPayment(payload, requirements, fetcher),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      `${RESEARCH_FACILITATOR}/settle`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
      }),
    ]);
  },
);
test("verify and settle independently validate bounded response fields", async () => {
  const verify = vi.fn(async () =>
    Response.json({
      isValid: true,
      payer: requirements.payTo,
      rawSecret: "not returned",
    }),
  );
  expect(await verifyResearchPayment(payload, requirements, verify)).toEqual({
    isValid: true,
    payer: requirements.payTo,
  });
  const settle = vi.fn(async () =>
    Response.json({
      success: true,
      payer: requirements.payTo,
      transaction: "1".repeat(88),
      network: RESEARCH_NETWORK,
    }),
  );
  expect(
    (await settleResearchPayment(payload, requirements, settle)).network,
  ).toBe(RESEARCH_NETWORK);
  const malformed = vi.fn(async () =>
    Response.json({
      success: "true",
      transaction: "1".repeat(88),
      network: RESEARCH_NETWORK,
    }),
  );
  await expect(
    settleResearchPayment(payload, requirements, malformed),
  ).rejects.toThrow();
  const oversized = vi.fn(async () => new Response("x".repeat(40_000)));
  await expect(
    settleResearchPayment(payload, requirements, oversized),
  ).rejects.toThrow();
  expect(oversized).toHaveBeenCalledTimes(1);
});
