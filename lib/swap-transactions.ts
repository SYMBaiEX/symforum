import { SYMF_TOKEN } from "./symf-token";
import {
  AccountRole,
  address,
  createNoopSigner,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessagePriorityFeeLamports,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  decompileTransactionMessage,
  getBase64Encoder,
  getBase64Decoder,
  getAddressDecoder,
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
  getBase64EncodedWireTransaction,
  blockhash,
  type Instruction,
  type Address,
  type AddressesByLookupTableAddress,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  getSyncNativeInstruction,
  getCloseAccountInstruction,
} from "@solana-program/token";
import { getBurnCheckedInstruction } from "@solana-program/token-2022";
import {
  SOL_MINT,
  rawAmount,
  record,
  providerJson,
  validateSwapRequest,
  type SwapRouteQuote,
  type SwapRouterConfig,
  type PreparedSwap,
} from "./swap-router";
import {
  swapRpc,
  verifiedMint,
  walletTokenAccount,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  type MintInfo,
} from "./swap-rpc";

const SYSTEM = "11111111111111111111111111111111";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const RAYDIUM = "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS";
const LOOKUP = "AddressLookupTab1e1111111111111111111111111";
const MAX_NETWORK_FEE = 1_000_000n;
const MAX_COMPUTE_PRICE = 500_000n;
const MAX_UNITS = 1_400_000;
function bytes(ix: Instruction) {
  return Uint8Array.from(ix.data ?? []);
}
function dataView(ix: Instruction) {
  const d = bytes(ix);
  return new DataView(d.buffer);
}
function at(ix: Instruction, index: number) {
  return ix.accounts?.[index]?.address;
}
function requireCondition(
  value: unknown,
  message = "Transaction does not match the reviewed swap.",
): asserts value {
  if (!value) throw new Error(message);
}
export async function associatedAccount(owner: string, mint: MintInfo) {
  return (
    await findAssociatedTokenPda({
      owner: address(owner),
      mint: address(mint.mint),
      tokenProgram: address(mint.tokenProgram),
    })
  )[0];
}
function apiInstruction(value: unknown): Instruction {
  const ix = record(value);
  requireCondition(
    typeof ix.programId === "string" &&
      typeof ix.data === "string" &&
      Array.isArray(ix.accounts) &&
      ix.accounts.length <= 256,
  );
  const data = getBase64Encoder().encode(ix.data);
  requireCondition(data.length <= 4096);
  return {
    programAddress: address(ix.programId),
    data,
    accounts: ix.accounts.map((a) => {
      const meta = record(a);
      requireCondition(
        typeof meta.pubkey === "string" &&
          typeof meta.isSigner === "boolean" &&
          typeof meta.isWritable === "boolean",
      );
      return {
        address: address(meta.pubkey),
        role: meta.isSigner
          ? meta.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : AccountRole.READONLY_SIGNER
          : meta.isWritable
            ? AccountRole.WRITABLE
            : AccountRole.READONLY,
      };
    }),
  };
}
async function lookupTables(
  rpcUrl: string,
  names: string[],
  fetcher: typeof fetch,
) {
  requireCondition(names.length <= 8, "Too many address lookup tables.");
  const map: AddressesByLookupTableAddress = {};
  if (!names.length) return map;
  names.forEach((n) => address(n));
  const response = await swapRpc<{ value: unknown[] }>(
    rpcUrl,
    "getMultipleAccounts",
    [names, { encoding: "base64", commitment: "confirmed" }],
    fetcher,
  );
  requireCondition(response.value.length === names.length);
  for (let i = 0; i < names.length; i++) {
    const entry = record(response.value[i]);
    requireCondition(
      entry.owner === LOOKUP &&
        Array.isArray(entry.data) &&
        typeof entry.data[0] === "string",
    );
    const raw = getBase64Encoder().encode(entry.data[0]);
    requireCondition(
      raw.length >= 56 &&
        (raw.length - 56) % 32 === 0 &&
        raw.length <= 56 + 256 * 32,
    );
    requireCondition(
      new DataView(Uint8Array.from(raw).buffer).getUint32(0, true) === 1,
    );
    const keys: Address[] = [];
    for (let p = 56; p < raw.length; p += 32)
      keys.push(getAddressDecoder().decode(raw.slice(p, p + 32)));
    map[address(names[i])] = keys;
  }
  return map;
}
function noOtherSigners(instructions: readonly Instruction[], wallet: string) {
  for (const ix of instructions)
    for (const a of ix.accounts ?? [])
      if (
        a.role === AccountRole.READONLY_SIGNER ||
        a.role === AccountRole.WRITABLE_SIGNER
      )
        requireCondition(
          a.address === wallet,
          "The route unexpectedly requires another signer.",
        );
}
function validateSetup(
  ix: Instruction,
  wallet: string,
  input: MintInfo,
  output: MintInfo,
  source: string,
  destination: string,
  swap: bigint,
) {
  const d = bytes(ix);
  const validAccount =
    (at(ix, 1) === source &&
      at(ix, 3) === input.mint &&
      at(ix, 5) === input.tokenProgram) ||
    (at(ix, 1) === destination &&
      at(ix, 3) === output.mint &&
      at(ix, 5) === output.tokenProgram);
  if (ix.programAddress === ASSOCIATED_TOKEN_PROGRAM) {
    requireCondition(
      (d.length === 0 || (d.length === 1 && d[0] <= 1)) &&
        at(ix, 0) === wallet &&
        at(ix, 2) === wallet &&
        at(ix, 4) === SYSTEM &&
        validAccount,
    );
  } else if (ix.programAddress === SYSTEM) {
    requireCondition(
      input.mint === SOL_MINT &&
        d.length === 12 &&
        dataView(ix).getUint32(0, true) === 2 &&
        dataView(ix).getBigUint64(4, true) === swap &&
        at(ix, 0) === wallet &&
        at(ix, 1) === source,
    );
  } else if (
    ix.programAddress === TOKEN_PROGRAM ||
    ix.programAddress === TOKEN_2022_PROGRAM
  ) {
    const native =
      input.mint === SOL_MINT
        ? source
        : output.mint === SOL_MINT
          ? destination
          : null;
    requireCondition(
      native &&
        ix.programAddress === TOKEN_PROGRAM &&
        at(ix, 0) === native &&
        ((d.length === 1 && d[0] === 17) ||
          (d.length === 1 &&
            d[0] === 9 &&
            at(ix, 1) === wallet &&
            at(ix, 2) === wallet)),
    );
  } else
    throw new Error(
      "Unsupported setup instruction; no transaction was signed.",
    );
}
/** A compromised provider cannot duplicate a valid funding/close instruction. */
export function validateSetupSequence(
  instructions: readonly Instruction[],
  wallet: string,
  input: MintInfo,
  output: MintInfo,
  source: string,
  destination: string,
  swap: bigint,
) {
  requireCondition(instructions.length <= 10);
  const seen = new Set<string>();
  for (const ix of instructions) {
    validateSetup(ix, wallet, input, output, source, destination, swap);
    const key = `${ix.programAddress}:${bytes(ix)[0] ?? "ata"}:${at(ix, ix.programAddress === ASSOCIATED_TOKEN_PROGRAM ? 1 : 0)}`;
    requireCondition(
      !seen.has(key),
      "Duplicate funding or account instruction.",
    );
    seen.add(key);
  }
}
/** Bind the on-chain spending and minimum-output arguments, not only the API JSON. */
export function validateSwapInstruction(
  ix: Instruction,
  quote: SwapRouteQuote,
  source: string,
  destination: string,
) {
  const d = bytes(ix);
  const view = dataView(ix);
  const r = quote.request;
  let user: number, src: number, dst: number, amountOffset: number;
  let inputMintIndex: number | null = null,
    outputMintIndex: number | null = null;
  if (quote.provider === "jupiter") {
    requireCondition(ix.programAddress === JUPITER && d.length >= 27);
    const disc = Array.from(d.slice(0, 8)).join(",");
    let slip: number, protocolFee: number, quotedOut: bigint;
    if (
      disc === "209,152,83,147,124,254,216,233" ||
      disc === "187,100,250,204,49,196,175,20"
    ) {
      const shared = disc.startsWith("209,");
      [user, src, dst, amountOffset] = shared ? [1, 2, 5, 9] : [0, 1, 2, 8];
      inputMintIndex = shared ? 6 : 3;
      outputMintIndex = shared ? 7 : 4;
      requireCondition(d.length >= amountOffset + 26);
      quotedOut = view.getBigUint64(amountOffset + 8, true);
      slip = view.getUint16(amountOffset + 16, true);
      protocolFee = view.getUint16(amountOffset + 18, true);
      requireCondition(
        view.getUint16(amountOffset + 20, true) === 0,
        "Unexpected positive-slippage fee.",
      );
      if (!shared)
        requireCondition(
          !at(ix, 7) || at(ix, 7) === JUPITER || at(ix, 7) === destination,
        );
    } else if (
      disc === "193,32,155,51,65,214,156,129" ||
      disc === "229,23,203,151,122,227,173,42"
    ) {
      const shared = disc.startsWith("193,");
      [user, src, dst, amountOffset] = shared
        ? [2, 3, 6, d.length - 19]
        : [1, 2, 3, d.length - 19];
      inputMintIndex = shared ? 7 : null;
      outputMintIndex = shared ? 8 : 5;
      quotedOut = view.getBigUint64(amountOffset + 8, true);
      slip = view.getUint16(amountOffset + 16, true);
      protocolFee = d[amountOffset + 18];
      if (!shared)
        requireCondition(
          !at(ix, 4) || at(ix, 4) === JUPITER || at(ix, 4) === destination,
        );
    } else throw new Error("Unsupported Jupiter instruction version.");
    requireCondition(
      quotedOut === BigInt(quote.outputAmountRaw) &&
        slip === r.slippageBps &&
        protocolFee === 0 &&
        (quotedOut * BigInt(10_000 - slip)) / 10_000n >=
          BigInt(quote.minimumOutputAmountRaw),
    );
  } else {
    requireCondition(
      ix.programAddress === RAYDIUM && d.length >= 17 && d[0] === 0,
    );
    [user, src, dst, amountOffset] = [4, 5, 6, 1];
    requireCondition(
      view.getBigUint64(9, true) >= BigInt(quote.minimumOutputAmountRaw),
    );
    requireCondition(
      ix.accounts?.some((a) => a.address === r.inputMint) &&
        ix.accounts?.some((a) => a.address === r.outputMint),
    );
  }
  requireCondition(
    at(ix, user) === r.wallet &&
      at(ix, src) === source &&
      at(ix, dst) === destination &&
      view.getBigUint64(amountOffset, true) === BigInt(quote.swapAmountRaw),
  );
  if (inputMintIndex !== null)
    requireCondition(at(ix, inputMintIndex) === r.inputMint);
  if (outputMintIndex !== null)
    requireCondition(at(ix, outputMintIndex) === r.outputMint);
}
async function feeInstructions(
  quote: SwapRouteQuote,
  config: SwapRouterConfig,
  input: MintInfo,
  source: string,
) {
  const amount = BigInt(quote.platformFeeRaw);
  if (!amount) return [];
  requireCondition(config.treasury, "Platform treasury is not configured.");
  const payer = createNoopSigner(address(quote.request.wallet));
  if (input.mint === SOL_MINT)
    return [
      getTransferSolInstruction({
        source: payer,
        destination: address(config.treasury),
        amount,
      }),
    ];
  const ata = await associatedAccount(config.treasury, input);
  return [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata,
      owner: address(config.treasury),
      mint: address(input.mint),
      tokenProgram: address(input.tokenProgram),
    }),
    getTransferCheckedInstruction(
      {
        source: address(source),
        mint: address(input.mint),
        destination: ata,
        authority: payer,
        amount,
        decimals: input.decimals,
      },
      { programAddress: address(input.tokenProgram) },
    ),
  ];
}
async function assembleAndSimulate(
  wallet: string,
  instructions: readonly Instruction[],
  tables: AddressesByLookupTableAddress,
  version: 0 | 1,
  config: SwapRouterConfig,
  fetcher: typeof fetch,
  computePrice = 1_000n,
): Promise<PreparedSwap> {
  noOtherSigners(instructions, wallet);
  requireCondition(
    computePrice >= 0n && computePrice <= MAX_COMPUTE_PRICE,
    "Priority fee exceeds the safety cap.",
  );
  const recent = await swapRpc<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>(
    config.rpcUrl,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    fetcher,
  );
  requireCondition(Number.isSafeInteger(recent.value.lastValidBlockHeight));
  const build = (limit: number, loadedDataLimit = 64 * 1024 * 1024) => {
    const base = setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: blockhash(recent.value.blockhash),
        lastValidBlockHeight: BigInt(recent.value.lastValidBlockHeight),
      },
      setTransactionMessageFeePayer(
        address(wallet),
        version === 0
          ? createTransactionMessage({ version: 0 })
          : createTransactionMessage({ version: 1 }),
      ),
    );
    const populated = appendTransactionMessageInstructions(instructions, base);
    const message = setTransactionMessageLoadedAccountsDataSizeLimit(
      loadedDataLimit,
      setTransactionMessageComputeUnitLimit(limit, populated),
    );
    if (message.version === 0)
      return compileTransaction(
        compressTransactionMessageUsingAddressLookupTables(
          setTransactionMessageComputeUnitPrice(computePrice, message),
          tables,
        ),
      );
    return compileTransaction(
      setTransactionMessagePriorityFeeLamports(
        (computePrice * BigInt(limit) + 999_999n) / 1_000_000n,
        message,
      ),
    );
  };
  const test = build(MAX_UNITS);
  const simulation = await swapRpc<{
    context: { slot: number };
    value: {
      err: unknown;
      unitsConsumed?: number;
      loadedAccountsDataSize?: number;
    };
  }>(
    config.rpcUrl,
    "simulateTransaction",
    [
      getBase64EncodedWireTransaction(test),
      { encoding: "base64", commitment: "confirmed", sigVerify: false },
    ],
    fetcher,
  );
  requireCondition(
    simulation.value.err === null &&
      Number.isSafeInteger(simulation.context.slot) &&
      simulation.context.slot >= 0,
    "Simulation failed. Nothing was signed or sent.",
  );
  const units = simulation.value.unitsConsumed;
  requireCondition(
    Number.isSafeInteger(units) &&
      Number(units) > 0 &&
      Number(units) <= MAX_UNITS,
    "Simulation did not return a valid resource estimate.",
  );
  const loaded = simulation.value.loadedAccountsDataSize;
  requireCondition(
    version !== 1 ||
      (Number.isSafeInteger(loaded) &&
        Number(loaded) > 0 &&
        Number(loaded) <= 64 * 1024 * 1024),
    "Simulation did not return a valid loaded-account resource estimate.",
  );
  const dataLimit =
    Number.isSafeInteger(loaded) && Number(loaded) > 0
      ? Math.min(
          64 * 1024 * 1024,
          Math.ceil((Number(loaded) + 32768) / 32768) * 32768,
        )
      : 64 * 1024 * 1024;
  const transaction = build(
    Math.min(MAX_UNITS, Math.ceil(Number(units) * 1.2)),
    dataLimit,
  );
  const finalSimulation = await swapRpc<{
    context: { slot: number };
    value: { err: unknown };
  }>(
    config.rpcUrl,
    "simulateTransaction",
    [
      getBase64EncodedWireTransaction(transaction),
      {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        minContextSlot: simulation.context.slot,
      },
    ],
    fetcher,
  );
  requireCondition(
    finalSimulation.value.err === null &&
      Number.isSafeInteger(finalSimulation.context.slot) &&
      finalSimulation.context.slot >= simulation.context.slot,
    "Final transaction simulation failed. Nothing was signed or sent.",
  );
  requireCondition(
    Object.keys(transaction.signatures).length === 1 &&
      Object.keys(transaction.signatures)[0] === wallet,
  );
  const wire = getBase64EncodedWireTransaction(transaction);
  requireCondition(
    getBase64Encoder().encode(wire).length <= (version === 1 ? 4096 : 1232),
    "Route is too large for this wallet transaction version.",
  );
  const fee = await swapRpc<{ value: number | null }>(
    config.rpcUrl,
    "getFeeForMessage",
    [
      getBase64Decoder().decode(transaction.messageBytes),
      { commitment: "confirmed" },
    ],
    fetcher,
  );
  requireCondition(
    Number.isSafeInteger(fee.value) &&
      Number(fee.value) >= 0 &&
      BigInt(fee.value!) <= MAX_NETWORK_FEE,
    "Network fee could not be verified within the safety cap.",
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(transaction.messageBytes),
  );
  return {
    transactionBase64: wire,
    transactionVersion: version,
    lastValidBlockHeight: recent.value.lastValidBlockHeight,
    simulationSlot: finalSimulation.context.slot,
    estimatedNetworkFeeLamports: String(fee.value),
    messageHash: Array.from(new Uint8Array(digest), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export async function buildSwapTransaction(
  quote: SwapRouteQuote,
  config: SwapRouterConfig,
  fetcher: typeof fetch = fetch,
): Promise<PreparedSwap> {
  const expected = validateSwapRequest(quote.request);
  requireCondition(
    Date.now() < quote.expiresAt && quote.expiresAt - quote.createdAt <= 25_000,
    "Quote expired. Review a fresh quote.",
  );
  requireCondition(
    expected.fee === BigInt(quote.platformFeeRaw) &&
      expected.swap === BigInt(quote.swapAmountRaw),
  );
  const [input, output] = await Promise.all([
    verifiedMint(config.rpcUrl, quote.request.inputMint, fetcher),
    verifiedMint(config.rpcUrl, quote.request.outputMint, fetcher),
  ]);
  const source = await associatedAccount(quote.request.wallet, input);
  const destination = await associatedAccount(quote.request.wallet, output);
  if (input.mint !== SOL_MINT)
    requireCondition(
      (await walletTokenAccount(
        config.rpcUrl,
        quote.request.wallet,
        input,
        expected.total,
        fetcher,
        source,
      )) === source,
      "Fund the selected wallet's associated token account before swapping.",
    );
  let instructions: Instruction[],
    tables: AddressesByLookupTableAddress,
    version: 0 | 1,
    price = 1_000n;
  if (quote.provider === "jupiter") {
    const j = quote.opaque;
    version = j.transactionVersion === 1 ? 1 : 0;
    requireCondition(!version || quote.request.supportsV1);
    requireCondition(
      Array.isArray(j.setupInstructions) &&
        Array.isArray(j.otherInstructions) &&
        j.otherInstructions.length === 0 &&
        !j.tipInstruction,
    );
    const setup = j.setupInstructions.map(apiInstruction);
    const swap = apiInstruction(j.swapInstruction);
    const cleanup = j.cleanupInstruction
      ? [apiInstruction(j.cleanupInstruction)]
      : [];
    validateSetupSequence(
      [...setup, ...cleanup],
      quote.request.wallet,
      input,
      output,
      source,
      destination,
      expected.swap,
    );
    validateSwapInstruction(swap, quote, source, destination);
    requireCondition(setup.length <= 8);
    instructions = [...setup, swap, ...cleanup];
    tables =
      version === 0
        ? await lookupTables(
            config.rpcUrl,
            Object.keys(record(j.addressesByLookupTableAddress ?? {})),
            fetcher,
          )
        : {};
    if (version === 1)
      price = rawAmount(String(j.computeUnitPrice ?? "1000"), true);
    else if (Array.isArray(j.computeBudgetInstructions))
      for (const raw of j.computeBudgetInstructions) {
        const ix = apiInstruction(raw);
        const d = bytes(ix);
        requireCondition(
          ix.programAddress === COMPUTE && (d[0] === 2 || d[0] === 3),
        );
        if (d[0] === 3) {
          requireCondition(d.length === 9);
          price = dataView(ix).getBigUint64(1, true);
        }
      }
  } else {
    version = 0;
    const response = await providerJson(
      "https://transaction-v1.raydium.io/transaction/swap-base-in",
      fetcher,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          computeUnitPriceMicroLamports: "1000",
          swapResponse: quote.opaque,
          txVersion: "V0",
          wallet: quote.request.wallet,
          wrapSol: input.mint === SOL_MINT,
          unwrapSol: output.mint === SOL_MINT,
          ...(input.mint !== SOL_MINT ? { inputAccount: source } : {}),
          outputAccount: destination,
        }),
      },
    );
    requireCondition(
      response.success === true &&
        Array.isArray(response.data) &&
        response.data.length === 1,
      "Only atomic single-transaction routes are supported.",
    );
    const raw = record(response.data[0]);
    requireCondition(typeof raw.transaction === "string");
    const tx = getTransactionDecoder().decode(
      getBase64Encoder().encode(raw.transaction),
    );
    requireCondition(
      Object.values(tx.signatures).every((s) => s === null),
      "Provider transaction was unexpectedly signed.",
    );
    const compiled = getCompiledTransactionMessageDecoder().decode(
      tx.messageBytes,
    );
    requireCondition(
      compiled.version === 0 &&
        compiled.staticAccounts[0] === quote.request.wallet,
    );
    tables = await lookupTables(
      config.rpcUrl,
      (compiled.addressTableLookups ?? []).map((t) => t.lookupTableAddress),
      fetcher,
    );
    const message = decompileTransactionMessage(compiled, {
      addressesByLookupTableAddress: tables,
      lastValidBlockHeight: 0n,
    });
    const swapsOnly: Instruction[] = [];
    let swaps = 0;
    for (const ix of message.instructions) {
      if (ix.programAddress === COMPUTE) continue;
      if (ix.programAddress === RAYDIUM && bytes(ix)[0] === 0) {
        validateSwapInstruction(ix, quote, source, destination);
        swapsOnly.push(ix);
        swaps++;
      } else {
        // Never execute opaque router setup helpers. Replace recognized native
        // wrap/close helpers with locally constructed official instructions.
        const d = bytes(ix);
        if (ix.programAddress === RAYDIUM)
          requireCondition(
            (d.length === 9 && d[0] === 5) || (d.length === 1 && d[0] === 6),
            "Unsupported Raydium setup instruction.",
          );
        else
          validateSetup(
            ix,
            quote.request.wallet,
            input,
            output,
            source,
            destination,
            expected.swap,
          );
      }
    }
    requireCondition(swaps === 1);
    const payer = createNoopSigner(address(quote.request.wallet));
    const setup = [input, output].map((mint) =>
      getCreateAssociatedTokenIdempotentInstruction({
        payer,
        owner: payer.address,
        mint: address(mint.mint),
        ata: address(mint === input ? source : destination),
        tokenProgram: address(mint.tokenProgram),
      }),
    );
    const wrap =
      input.mint === SOL_MINT
        ? [
            getTransferSolInstruction({
              source: payer,
              destination: address(source),
              amount: expected.swap,
            }),
            getSyncNativeInstruction({ account: address(source) }),
          ]
        : [];
    const native =
      input.mint === SOL_MINT
        ? source
        : output.mint === SOL_MINT
          ? destination
          : null;
    const cleanup = native
      ? [
          getCloseAccountInstruction({
            account: address(native),
            destination: payer.address,
            owner: payer,
          }),
        ]
      : [];
    validateSetupSequence(
      [...setup, ...wrap, ...cleanup],
      payer.address,
      input,
      output,
      source,
      destination,
      expected.swap,
    );
    instructions = [...setup, ...wrap, ...swapsOnly, ...cleanup];
  }
  requireCondition(
    Date.now() < quote.expiresAt,
    "Quote expired before review.",
  );
  return assembleAndSimulate(
    quote.request.wallet,
    [...(await feeInstructions(quote, config, input, source)), ...instructions],
    tables,
    version,
    config,
    fetcher,
    price,
  );
}

export type PromotionPaymentIntent = {
  wallet: string;
  treasury: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  amountRaw: string;
  treasuryAmountRaw: string;
  burnAmountRaw: string;
  reference: string;
  checkoutExpiresAt: number;
};
/** Constructs the approved 50/50 transfer-and-burn, never signs or broadcasts it. */
export async function buildPromotionTransaction(
  intent: PromotionPaymentIntent,
  config: SwapRouterConfig,
  supportsV1: boolean,
  fetcher: typeof fetch = fetch,
): Promise<PreparedSwap> {
  requireCondition(
    Date.now() + 15_000 < intent.checkoutExpiresAt,
    "Promotion checkout expired. Request a new slot.",
  );
  requireCondition(
    config.treasury === intent.treasury && intent.mint === SYMF_TOKEN.mint,
  );
  address(intent.reference);
  const total = rawAmount(intent.amountRaw),
    transfer = rawAmount(intent.treasuryAmountRaw),
    burn = rawAmount(intent.burnAmountRaw);
  requireCondition(
    transfer + burn === total && total % 2n === 0n && burn === total / 2n,
    "Invalid promotion payment split.",
  );
  const mint = await verifiedMint(config.rpcUrl, intent.mint, fetcher);
  requireCondition(
    mint.tokenProgram === intent.tokenProgram &&
      mint.decimals === intent.decimals &&
      mint.tokenProgram === TOKEN_2022_PROGRAM,
  );
  const source = address(
    await walletTokenAccount(
      config.rpcUrl,
      intent.wallet,
      mint,
      total,
      fetcher,
    ),
  );
  const destination = await associatedAccount(intent.treasury, mint),
    payer = createNoopSigner(address(intent.wallet));
  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer,
      ata: destination,
      owner: address(intent.treasury),
      mint: address(mint.mint),
      tokenProgram: address(mint.tokenProgram),
    }),
    getTransferCheckedInstruction(
      {
        source,
        mint: address(mint.mint),
        destination,
        authority: payer,
        amount: transfer,
        decimals: mint.decimals,
      },
      { programAddress: address(mint.tokenProgram) },
    ),
    getBurnCheckedInstruction({
      account: source,
      mint: address(mint.mint),
      authority: payer,
      amount: burn,
      decimals: mint.decimals,
    }),
    {
      programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      accounts: [{ address: payer.address, role: AccountRole.READONLY_SIGNER }],
      data: new TextEncoder().encode(`SYMF-PROMOTION:${intent.reference}`),
    },
  ];
  return assembleAndSimulate(
    intent.wallet,
    instructions,
    {},
    supportsV1 ? 1 : 0,
    config,
    fetcher,
  );
}
