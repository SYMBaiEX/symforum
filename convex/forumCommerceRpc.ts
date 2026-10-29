import {
  boundedArray,
  COMMERCE_MINT,
  COMMERCE_POOL,
  holderEligible,
  record,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  unsignedRaw,
} from "../lib/forum-commerce";
/** Cap decoded bytes while streaming; never buffer an unbounded provider body. */
async function boundedResponse(response: Response, limit: number) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Provider response too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider response empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new Error("Provider response too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function commerceRpc(
  url: string,
  method: string,
  params: unknown[],
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Chain data unavailable.");
  const text = await boundedResponse(response, 2_000_000);
  const parsed = record(JSON.parse(text));
  if (
    parsed.error ||
    parsed.jsonrpc !== "2.0" ||
    !Object.hasOwn(parsed, "result")
  )
    throw new Error("Chain data unavailable.");
  return parsed.result;
}
export async function commerceMint(
  url: string,
  mint: string,
  fetcher: typeof fetch = fetch,
) {
  const result = record(
    await commerceRpc(
      url,
      "getAccountInfo",
      [mint, { encoding: "jsonParsed", commitment: "finalized" }],
      fetcher,
    ),
  );
  const value = record(result.value),
    parsed = record(record(value.data).parsed),
    info = record(parsed.info);
  if (
    ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(String(value.owner)) ||
    parsed.type !== "mint" ||
    info.isInitialized !== true ||
    !Number.isSafeInteger(info.decimals) ||
    (info.decimals as number) < 0 ||
    (info.decimals as number) > 18
  )
    throw new Error("Unsupported token mint.");
  if (
    info.extensions !== undefined &&
    boundedArray(info.extensions, 32).some(
      (e) =>
        !["metadataPointer", "tokenMetadata"].includes(
          String(record(e).extension),
        ),
    )
  )
    throw new Error("Unsupported token extensions.");
  return {
    tokenProgram: value.owner as string,
    decimals: info.decimals as number,
    symbol: String(
      record(
        boundedArray(info.extensions ?? [], 32)
          .map(record)
          .find((e) => e.extension === "tokenMetadata")?.state,
      ).symbol ?? "",
    ).slice(0, 12),
    name: String(
      record(
        boundedArray(info.extensions ?? [], 32)
          .map(record)
          .find((e) => e.extension === "tokenMetadata")?.state,
      ).name ?? "",
    ).slice(0, 80),
  };
}
export async function commerceBenefit(
  url: string,
  wallet: string,
  fetcher: typeof fetch = fetch,
) {
  const mint = await commerceMint(url, COMMERCE_MINT, fetcher);
  const result = record(
    await commerceRpc(
      url,
      "getTokenAccountsByOwner",
      [
        wallet,
        { mint: COMMERCE_MINT },
        { encoding: "jsonParsed", commitment: "finalized" },
      ],
      fetcher,
    ),
  );
  let sum = 0n;
  for (const row of boundedArray(result.value, 100)) {
    const account = record(record(row).account),
      parsed = record(record(account.data).parsed),
      info = record(parsed.info),
      token = record(info.tokenAmount);
    if (
      account.owner !== mint.tokenProgram ||
      parsed.type !== "account" ||
      info.owner !== wallet ||
      info.mint !== COMMERCE_MINT ||
      token.decimals !== mint.decimals ||
      typeof token.amount !== "string" ||
      !["initialized", "frozen"].includes(String(info.state))
    )
      throw new Error("Unverified token account.");
    if (info.state === "frozen") continue;
    sum += unsignedRaw(token.amount);
  }
  unsignedRaw(String(sum));
  const response = await fetcher(
    `https://api.dexscreener.com/token-pairs/v1/solana/${COMMERCE_MINT}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    },
  );
  const age = Number(response.headers.get("age") ?? "0");
  if (!response.ok || !Number.isFinite(age) || age < 0 || age > 60)
    throw new Error("Token price unavailable.");
  const data = await boundedResponse(response, 1_000_000);
  const pairs = boundedArray(JSON.parse(data), 100).map(record);
  const pair = pairs.find(
    (p) =>
      p.chainId === "solana" &&
      p.pairAddress === COMMERCE_POOL &&
      record(p.baseToken).address === COMMERCE_MINT &&
      record(p.quoteToken).address ===
        "So11111111111111111111111111111111111111112",
  );
  if (
    !pair ||
    typeof pair.priceUsd !== "string" ||
    Number(record(pair.liquidity).usd) < 1000 ||
    !Number.isFinite(Number(record(pair.liquidity).usd)) ||
    Number(record(pair.volume).h1) <= 0 ||
    !Number.isFinite(Number(record(pair.volume).h1))
  )
    throw new Error("Reliable token price unavailable.");
  return {
    balanceRaw: String(sum),
    decimals: mint.decimals,
    priceUsd: pair.priceUsd,
    eligible: holderEligible(String(sum), mint.decimals, pair.priceUsd),
  };
}
