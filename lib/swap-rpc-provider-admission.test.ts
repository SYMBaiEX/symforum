import { expect, test, vi } from "vitest";
import { ProviderAdmissionError } from "./provider-admission-error";
import { SwapRpcError } from "./swap-preparation-errors";
import { swapRpc } from "./swap-rpc";

test.each(["getFeeForMessage", "simulateTransaction", "sendTransaction"])(
  "%s admission denial propagates unchanged, never as a retryable network failure",
  async (method) => {
    const denied = new ProviderAdmissionError("helius", "burst", null);
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw denied;
    });
    const attempt = swapRpc(
      "https://mainnet.helius-rpc.com/?api-key=invented",
      method,
      [],
      fetcher,
    );
    await expect(attempt).rejects.toBe(denied);
    // prepareManagedSwap's existing fee retry admits only SwapRpcError
    // rpc_unavailable. A central gate refusal must never enter that branch.
    expect(denied).not.toBeInstanceOf(SwapRpcError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
test("a real fetch failure retains the existing safe network classification", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("private provider URL/body");
  });
  await expect(
    swapRpc("https://mainnet.helius-rpc.com/", "getFeeForMessage", [], fetcher),
  ).rejects.toMatchObject({ code: "rpc_unavailable" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
