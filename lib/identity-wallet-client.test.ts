// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import type { WalletPluginConfig } from "@solana/kit-plugin-wallet";

const boundary = vi.hoisted(() => ({ plugin: vi.fn() }));
vi.mock("@solana/kit-plugin-wallet", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@solana/kit-plugin-wallet")>();
  return {
    ...actual,
    walletWithoutSigner: (config: WalletPluginConfig) => {
      boundary.plugin(config);
      return actual.walletWithoutSigner(config);
    },
  };
});

import { createIdentityWalletClient } from "./identity-wallet-client";

afterEach(() => vi.clearAllMocks());

test("shared discovery accepts each supported identity or transaction capability", () => {
  const client = createIdentityWalletClient();
  try {
    const config = boundary.plugin.mock.calls[0][0] as WalletPluginConfig;
    const filter = config.filter!;
    const accepts = (features: string[]) =>
      filter({ features } as unknown as Parameters<typeof filter>[0]);
    for (const feature of [
      "solana:signIn",
      "solana:signMessage",
      "solana:signTransaction",
      "solana:signAndSendTransaction",
    ]) {
      expect(accepts([feature])).toBe(true);
    }
    expect(accepts(["ethereum:personalSign"])).toBe(false);
    expect(accepts([])).toBe(false);
    expect(config).toMatchObject({
      chain: "solana:mainnet",
      autoConnect: false,
      storage: null,
    });
    expect(client.wallet.getState().connected).toBeNull();
  } finally {
    client[Symbol.dispose]();
  }
});
