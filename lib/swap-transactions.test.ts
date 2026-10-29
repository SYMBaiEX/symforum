import { describe, test, expect } from "vitest";
import {
  AccountRole,
  address,
  createNoopSigner,
  getBase64Decoder,
  getTransactionDecoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  getTransferCheckedInstruction,
  getSyncNativeInstruction,
} from "@solana-program/token";
import {
  buildPromotionTransaction,
  validateSwapInstruction,
  validateSetupSequence,
  associatedAccount,
} from "./swap-transactions";
import { SOL_MINT, USDC_MINT, type SwapRouteQuote } from "./swap-router";
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, verifiedMint } from "./swap-rpc";
import { SYMF_TOKEN } from "./symf-token";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  treasury = "11111111111111111111111111111111";
const mint = {
  mint: SYMF_TOKEN.mint,
  tokenProgram: TOKEN_2022_PROGRAM,
  decimals: 6,
};
const input = { mint: SOL_MINT, tokenProgram: TOKEN_PROGRAM, decimals: 9 },
  output = { mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM, decimals: 6 };
const quote: SwapRouteQuote = {
  id: "test",
  provider: "jupiter",
  request: {
    wallet,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amountRaw: "1000",
    slippageBps: 50,
    platformFeeBps: 0,
    supportsV1: false,
  },
  swapAmountRaw: "1000",
  platformFeeRaw: "0",
  outputAmountRaw: "2000",
  minimumOutputAmountRaw: "1990",
  priceImpactBps: 1,
  routeLabels: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 25000,
  opaque: {},
};
async function jupiter() {
  const source = await associatedAccount(wallet, input),
    destination = await associatedAccount(wallet, output);
  const accounts = [
    TOKEN_PROGRAM,
    wallet,
    source,
    treasury,
    treasury,
    destination,
    SOL_MINT,
    USDC_MINT,
  ].map((a, i) => ({
    address: address(a),
    role: i === 1 ? AccountRole.READONLY_SIGNER : AccountRole.READONLY,
  }));
  const data = new Uint8Array(39);
  data.set([209, 152, 83, 147, 124, 254, 216, 233]);
  const view = new DataView(data.buffer);
  view.setBigUint64(9, 1000n, true);
  view.setBigUint64(17, 2000n, true);
  view.setUint16(25, 50, true);
  return {
    source,
    destination,
    ix: {
      programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      accounts,
      data,
    },
  };
}
describe("exact instruction binding", () => {
  test("binds Jupiter amount, recipient, mint, slippage and zero provider fees", async () => {
    const { source, destination, ix } = await jupiter();
    expect(() =>
      validateSwapInstruction(ix, quote, source, destination),
    ).not.toThrow();
  });
  test.each([9, 17, 25, 27, 29])(
    "rejects mutated amount/fee field %s",
    async (offset) => {
      const { source, destination, ix } = await jupiter();
      ix.data[offset]++;
      expect(() =>
        validateSwapInstruction(ix, quote, source, destination),
      ).toThrow();
    },
  );
  test.each([1, 2, 5, 6, 7])(
    "rejects swapped critical account %s",
    async (i) => {
      const { source, destination, ix } = await jupiter();
      ix.accounts[i].address = address(treasury);
      expect(() =>
        validateSwapInstruction(ix, quote, source, destination),
      ).toThrow();
    },
  );
  test("does not advertise a higher minimum than the instruction enforces", async () => {
    const { source, destination, ix } = await jupiter();
    expect(() =>
      validateSwapInstruction(
        ix,
        { ...quote, minimumOutputAmountRaw: "1991" },
        source,
        destination,
      ),
    ).toThrow();
  });
  test("rejects extra token approvals and unknown setup programs", async () => {
    const source = await associatedAccount(wallet, input),
      dest = await associatedAccount(wallet, output);
    const malicious = getTransferCheckedInstruction({
      source,
      mint: address(SOL_MINT),
      destination: address(treasury),
      authority: createNoopSigner(address(wallet)),
      amount: 1n,
      decimals: 9,
    });
    expect(() =>
      validateSetupSequence(
        [malicious],
        wallet,
        input,
        output,
        source,
        dest,
        1000n,
      ),
    ).toThrow();
  });
  test("rejects duplicated otherwise valid SOL funding", async () => {
    const source = await associatedAccount(wallet, input),
      dest = await associatedAccount(wallet, output);
    const ix = getTransferSolInstruction({
      source: createNoopSigner(address(wallet)),
      destination: source,
      amount: 1000n,
    });
    expect(() =>
      validateSetupSequence(
        [ix, ix],
        wallet,
        input,
        output,
        source,
        dest,
        1000n,
      ),
    ).toThrow(/Duplicate/);
  });
  test("rejects opaque Raydium native helpers instead of trusting decoy metas", async () => {
    const source = await associatedAccount(wallet, input),
      dest = await associatedAccount(wallet, output);
    const ix = {
      programAddress: address("routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS"),
      data: new Uint8Array([6]),
      accounts: [
        { address: address(wallet), role: AccountRole.WRITABLE_SIGNER },
        { address: source, role: AccountRole.WRITABLE },
      ],
    };
    expect(() =>
      validateSetupSequence([ix], wallet, input, output, source, dest, 1000n),
    ).toThrow();
  });
  test("rejects extra signer or mismatched sync account", async () => {
    const source = await associatedAccount(wallet, input),
      dest = await associatedAccount(wallet, output);
    expect(() =>
      validateSetupSequence(
        [getSyncNativeInstruction({ account: address(treasury) })],
        wallet,
        input,
        output,
        source,
        dest,
        1000n,
      ),
    ).toThrow();
  });
});
describe("promotion transaction construction (mock RPC, never a real payment)", () => {
  async function fixture(failFinal = false) {
    const source = await associatedAccount(wallet, mint),
      simulations: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const { method, params } = JSON.parse(String(init?.body));
      let result: unknown;
      if (method === "getAccountInfo")
        result = {
          value: {
            owner: TOKEN_2022_PROGRAM,
            data: {
              parsed: {
                type: "mint",
                info: {
                  isInitialized: true,
                  decimals: 6,
                  extensions: [
                    { extension: "metadataPointer" },
                    { extension: "tokenMetadata" },
                  ],
                },
              },
            },
          },
        };
      else if (method === "getTokenAccountsByOwner")
        result = {
          value: [
            {
              pubkey: source,
              account: {
                owner: TOKEN_2022_PROGRAM,
                data: {
                  parsed: {
                    type: "account",
                    info: {
                      owner: wallet,
                      mint: mint.mint,
                      state: "initialized",
                      tokenAmount: { amount: "20000000000", decimals: 6 },
                    },
                  },
                },
              },
            },
          ],
        };
      else if (method === "getLatestBlockhash")
        result = {
          value: { blockhash: treasury, lastValidBlockHeight: 99999 },
        };
      else if (method === "simulateTransaction") {
        simulations.push(params[0]);
        result = {
          context: { slot: simulations.length },
          value: {
            err:
              failFinal && simulations.length === 2
                ? { InstructionError: [1, "mock failure"] }
                : null,
            unitsConsumed: 100000,
            loadedAccountsDataSize: 100000,
          },
        };
      } else if (method === "getFeeForMessage") result = { value: 5005 };
      else throw new Error(`Unexpected mocked method ${method}`);
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    };
    return { source, simulations, fetcher };
  }
  const intent = () => ({
    wallet,
    treasury,
    mint: mint.mint,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    amountRaw: "10000000000",
    treasuryAmountRaw: "5000000000",
    burnAmountRaw: "5000000000",
    reference: USDC_MINT,
    checkoutExpiresAt: Date.now() + 600000,
  });
  test.each([false, true])(
    "builds atomic 50/50 transfer + actual burn with transaction-v1=%s",
    async (v1) => {
      const f = await fixture();
      const built = await buildPromotionTransaction(
        intent(),
        { rpcUrl: "https://rpc.example", treasury },
        v1,
        f.fetcher,
      );
      expect(built.simulationSlot).toBe(2);
      expect(f.simulations).toHaveLength(2);
      expect(f.simulations[1]).toBe(built.transactionBase64);
      expect(built.transactionVersion).toBe(v1 ? 1 : 0);
      const tx = getTransactionDecoder().decode(
        getBase64Encoder().encode(built.transactionBase64),
      );
      expect(Object.values(tx.signatures)).toEqual([null]);
      const message = decompileTransactionMessage(
        getCompiledTransactionMessageDecoder().decode(tx.messageBytes),
        { lastValidBlockHeight: 99999n },
      );
      const tokenIxs = message.instructions.filter(
        (i) => i.programAddress === TOKEN_2022_PROGRAM,
      );
      expect(tokenIxs.map((i) => i.data?.[0])).toEqual([12, 15]);
      for (const ix of tokenIxs)
        expect(
          new DataView(Uint8Array.from(ix.data!).buffer).getBigUint64(1, true),
        ).toBe(5000000000n);
      expect(tokenIxs[0].accounts?.[0].address).toBe(f.source);
      expect(tokenIxs[1].accounts?.[0].address).toBe(f.source);
      expect(getBase64Decoder().decode(tx.messageBytes)).toBeTruthy();
    },
  );
  test("never returns a transaction if final exact-message simulation fails", async () => {
    const f = await fixture(true);
    await expect(
      buildPromotionTransaction(
        intent(),
        { rpcUrl: "https://rpc.example", treasury },
        false,
        f.fetcher,
      ),
    ).rejects.toThrow(/Final transaction simulation failed/);
  });
  test("rejects modified split before any chain request", async () => {
    const f = await fixture();
    await expect(
      buildPromotionTransaction(
        { ...intent(), burnAmountRaw: "1" },
        { rpcUrl: "https://rpc.example", treasury },
        false,
        f.fetcher,
      ),
    ).rejects.toThrow();
    expect(f.simulations).toEqual([]);
  });
  test("unsupported Token2022 extensions fail closed", async () => {
    await expect(
      verifiedMint("https://rpc.example", mint.mint, async () =>
        Response.json({
          result: {
            value: {
              owner: TOKEN_2022_PROGRAM,
              data: {
                parsed: {
                  type: "mint",
                  info: {
                    isInitialized: true,
                    decimals: 6,
                    extensions: [{ extension: "transferHook" }],
                  },
                },
              },
            },
          },
        }),
      ),
    ).rejects.toThrow(/extensions/);
  });
});
