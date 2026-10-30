import { expect, test } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getSyncNativeInstruction } from "@solana-program/token";
import {
  normalizeManagedOrder,
  JUPITER_REFERRAL_PROJECT,
  JUPITER_REFERRAL_PROGRAM,
} from "./jupiter-managed";
import { associatedAccount, prepareManagedSwap } from "./swap-transactions";
import { SOL_MINT, USDC_MINT } from "./swap-router";
import { TOKEN_PROGRAM } from "./swap-rpc";
const wallet = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY",
  referralAccount = "DGw5drZY3YxHDtNfU7gFJbjzfdW4naEgieTzvp3yie7z",
  JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
async function fixture(
  change: {
    fee?: number;
    duplicate?: boolean;
    foreignInstruction?: boolean;
    output?: string;
    authority?: string;
    share?: number;
    simulationError?: unknown;
    networkFee?: number;
  } = {},
) {
  const source = await associatedAccount(wallet, {
      mint: SOL_MINT,
      tokenProgram: TOKEN_PROGRAM,
      decimals: 9,
    }),
    destination = await associatedAccount(wallet, {
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM,
      decimals: 6,
    }),
    feeAccount = await associatedAccount(referralAccount, {
      mint: SOL_MINT,
      tokenProgram: TOKEN_PROGRAM,
      decimals: 9,
    });
  const data = new Uint8Array(39),
    view = new DataView(data.buffer);
  data.set([187, 100, 250, 204, 49, 196, 175, 20]);
  view.setBigUint64(8, 10000000n, true);
  view.setBigUint64(16, 990000n, true);
  view.setUint16(24, 50, true);
  view.setUint16(26, change.fee ?? 50, true);
  const swap: Instruction = {
    programAddress: address(JUPITER),
    data,
    accounts: [
      wallet,
      source,
      change.output ?? destination,
      SOL_MINT,
      USDC_MINT,
      TOKEN_PROGRAM,
      TOKEN_PROGRAM,
      JUPITER,
      JUPITER,
      JUPITER,
      feeAccount,
    ].map((a, i) => ({
      address: address(a),
      role:
        i === 0
          ? AccountRole.READONLY_SIGNER
          : [1, 2, 10].includes(i)
            ? AccountRole.WRITABLE
            : AccountRole.READONLY,
    })),
  };
  const funding = getTransferSolInstruction({
    source: createNoopSigner(address(wallet)),
    destination: address(source),
    amount: 10000000n,
  });
  const ixs = [
    funding,
    ...(change.duplicate ? [funding] : []),
    getSyncNativeInstruction({ account: address(source) }),
    swap,
    ...(change.foreignInstruction
      ? [{ programAddress: address(USDC_MINT), data: new Uint8Array() }]
      : []),
  ];
  const tx = compileTransaction(
    appendTransactionMessageInstructions(
      ixs,
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash("11111111111111111111111111111111"),
          lastValidBlockHeight: 400000001n,
        },
        setTransactionMessageFeePayer(
          address(wallet),
          createTransactionMessage({ version: 0 }),
        ),
      ),
    ),
  );
  const transaction = getBase64EncodedWireTransaction(tx);
  const request = {
    wallet,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amountRaw: "10000000",
    slippageBps: 50,
    platformFeeBps: 50,
    supportsV1: false,
  };
  const config = {
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=fixture",
    treasury: wallet,
    referralAccount,
    jupiterApiKey: "fixture",
  };
  const quote = normalizeManagedOrder(
    {
      router: "metis",
      gasless: false,
      ...request,
      taker: wallet,
      swapMode: "ExactIn",
      inAmount: request.amountRaw,
      outAmount: "990000",
      otherAmountThreshold: "985050",
      priceImpactPct: "0.01",
      feeBps: 50,
      feeMint: SOL_MINT,
      platformFee: { feeBps: 50, feeMint: SOL_MINT },
      referralAccount,
      signatureFeeLamports: 5000,
      prioritizationFeeLamports: 0,
      rentFeeLamports: 2000000,
      transaction,
      transactionVersion: 0,
      requestId: "test-order",
      lastValidBlockHeight: "400000001",
    },
    request,
    config,
  );
  const token = new Uint8Array(165);
  token.set(getAddressEncoder().encode(address(SOL_MINT)));
  token.set(
    getAddressEncoder().encode(address(change.authority ?? referralAccount)),
    32,
  );
  token[108] = 1;
  const referral = new Uint8Array(80);
  referral.set(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("account:ReferralAccount"),
      ),
    ).slice(0, 8),
  );
  referral.set(getAddressEncoder().encode(address(wallet)), 8);
  referral.set(
    getAddressEncoder().encode(address(JUPITER_REFERRAL_PROJECT)),
    40,
  );
  new DataView(referral.buffer).setUint16(72, change.share ?? 8000, true);
  const calls: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const r = JSON.parse(String(init?.body));
    calls.push(r.method);
    let result;
    if (r.method === "getAccountInfo")
      result = {
        value: {
          owner: TOKEN_PROGRAM,
          data: {
            parsed: {
              type: "mint",
              info: {
                decimals: r.params[0] === SOL_MINT ? 9 : 6,
                isInitialized: true,
              },
            },
          },
        },
      };
    else if (r.method === "getMultipleAccounts")
      result = {
        value: [
          {
            owner: TOKEN_PROGRAM,
            data: [getBase64Decoder().decode(token), "base64"],
          },
          {
            owner: JUPITER_REFERRAL_PROGRAM,
            data: [getBase64Decoder().decode(referral), "base64"],
          },
        ],
      };
    else if (r.method === "simulateTransaction") {
      expect(r.params[0]).toBe(transaction); // No rebuilding the provider transaction.
      expect(r.params[1].sigVerify).toBe(false);
      result = {
        context: { slot: 400 },
        value: { err: change.simulationError ?? null, unitsConsumed: 100000 },
      };
    } else if (r.method === "getFeeForMessage")
      result = { value: change.networkFee ?? 5000 };
    else throw Error("Unexpected RPC");
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
  return { quote, config, fetcher, transaction, calls };
}
test("managed preparation verifies referral and simulates the unchanged assembled transaction", async () => {
  const f = await fixture();
  expect(await prepareManagedSwap(f.quote, f.config, f.fetcher)).toMatchObject({
    transactionBase64: f.transaction,
    transactionVersion: 0,
    lastValidBlockHeight: 400000001,
    simulationSlot: 400,
    estimatedNetworkFeeLamports: "5000",
  });
  expect(f.calls.filter((x) => x === "simulateTransaction")).toHaveLength(1);
  expect(f.calls).not.toContain("sendTransaction");
});
test.each([
  { fee: 0 },
  { fee: 100 },
  { duplicate: true },
  { foreignInstruction: true },
  { output: wallet },
  { authority: wallet },
  { share: 5000 },
  { simulationError: "failure" },
  { networkFee: 1000001 },
])(
  "managed preparation rejects unsafe transaction %j without signing/sending",
  async (change) => {
    const f = await fixture(change);
    await expect(
      prepareManagedSwap(f.quote, f.config, f.fetcher),
    ).rejects.toThrow();
    expect(f.calls).not.toContain("sendTransaction");
  },
);

test("a lagging fee replica gets one read-only retry with identical message and slot, not another simulation", async () => {
  const f = await fixture();
  const fees: unknown[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const input = JSON.parse(String(init?.body));
    if (input.method === "getFeeForMessage") {
      fees.push(input.params);
      if (fees.length === 1)
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32016, message: "private provider body" },
        });
    }
    return f.fetcher(url, init);
  };
  await prepareManagedSwap(f.quote, f.config, fetcher);
  expect(fees).toHaveLength(2);
  expect(fees[0]).toEqual(fees[1]);
  expect(f.calls.filter((x) => x === "simulateTransaction")).toHaveLength(1);
});

test("invalid RPC fee requests fail closed without a read retry or provider text", async () => {
  const f = await fixture();
  let fees = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const input = JSON.parse(String(init?.body));
    if (input.method === "getFeeForMessage") {
      fees++;
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32602, message: "private provider body" },
      });
    }
    return f.fetcher(url, init);
  };
  await expect(
    prepareManagedSwap(f.quote, f.config, fetcher),
  ).rejects.toMatchObject({ code: "rpc_unavailable", rpcCode: -32602 });
  expect(fees).toBe(1);
});
