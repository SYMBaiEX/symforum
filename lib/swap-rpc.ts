import { address } from "@solana/kit";
import { providerJson, record, rawAmount } from "./swap-router";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export async function swapRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const url = new URL(rpcUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|\[)/.test(
      url.hostname,
    )
  )
    throw new Error("A secure server-side Solana RPC is required.");
  const response = await providerJson(url.toString(), fetcher, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (response.error || !("result" in response))
    throw new Error("Solana RPC could not verify the request.");
  return response.result as T;
}
export type MintInfo = { mint: string; tokenProgram: string; decimals: number };
/** Metadata-only Token-2022 extensions are allowed; transfer behavior extensions are not. */
export async function verifiedMint(
  rpcUrl: string,
  mint: string,
  fetcher: typeof fetch = fetch,
): Promise<MintInfo> {
  address(mint);
  const result = await swapRpc<{ value: unknown }>(
    rpcUrl,
    "getAccountInfo",
    [mint, { encoding: "jsonParsed", commitment: "confirmed" }],
    fetcher,
  );
  const account = record(result.value);
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(String(account.owner)))
    throw new Error("Unsupported token program.");
  const parsed = record(record(account.data).parsed);
  const info = record(parsed.info);
  if (
    parsed.type !== "mint" ||
    info.isInitialized !== true ||
    !Number.isInteger(info.decimals) ||
    Number(info.decimals) > 18 ||
    Number(info.decimals) < 0
  )
    throw new Error("Token mint could not be verified.");
  const extensions = info.extensions ?? [];
  if (
    !Array.isArray(extensions) ||
    extensions.some(
      (e) =>
        !["metadataPointer", "tokenMetadata", "immutableOwner"].includes(
          String(record(e).extension),
        ),
    )
  )
    throw new Error("This token has unsupported transfer extensions.");
  return {
    mint,
    tokenProgram: String(account.owner),
    decimals: Number(info.decimals),
  };
}
export async function walletTokenAccount(
  rpcUrl: string,
  wallet: string,
  mint: MintInfo,
  needed: bigint,
  fetcher: typeof fetch = fetch,
  requiredAccount?: string,
) {
  address(wallet);
  const result = await swapRpc<{ value: unknown[] }>(
    rpcUrl,
    "getTokenAccountsByOwner",
    [
      wallet,
      { mint: mint.mint },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ],
    fetcher,
  );
  if (!Array.isArray(result.value) || result.value.length > 100)
    throw new Error("Wallet token accounts could not be verified.");
  for (const row of result.value) {
    const entry = record(row);
    const account = record(entry.account);
    const info = record(record(record(account.data).parsed).info);
    const amount = record(info.tokenAmount);
    if (
      account.owner === mint.tokenProgram &&
      info.owner === wallet &&
      info.mint === mint.mint &&
      info.state === "initialized" &&
      amount.decimals === mint.decimals &&
      rawAmount(amount.amount, true) >= needed
    ) {
      const key = String(entry.pubkey);
      address(key);
      if (requiredAccount && key !== requiredAccount) continue;
      return key;
    }
  }
  throw new Error("No single eligible token account has enough balance.");
}
