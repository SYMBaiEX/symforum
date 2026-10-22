// Fixed free pilot endpoint. No credentials, arbitrary URLs or provider rotation.
// https://solana.publicnode.com/
const RPC_URL = "https://solana-rpc.publicnode.com";
const RPC_ID = "symbaiex-token-mint-validation";
const MAX_RESPONSE_BYTES = 256 * 1_024;
const FAILURE = "Solana mint verification failed.";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TOKEN_PROGRAMS = new Map([
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "spl-token"],
  ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "spl-token-2022"],
]);

export class SolanaMintVerificationError extends Error {
  constructor(readonly code: TokenDataErrorCode) {
    super(FAILURE);
    this.name = "SolanaMintVerificationError";
  }
}

class AttemptFailure extends Error {
  constructor(
    readonly code: TokenDataErrorCode,
    readonly retryDelay: number | null = 250,
  ) {
    super("Solana mint verification attempt failed.");
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function address(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44)
    return false;
  let decoded = BigInt(0);
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * BigInt(58) + BigInt(digit);
  }
  let bytes = 0;
  while (decoded) {
    decoded >>= BigInt(8);
    bytes++;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes++;
  }
  return bytes === 32;
}

function initializedMint(value: unknown): boolean {
  const account = object(value);
  if (
    !account ||
    account.executable !== false ||
    typeof account.owner !== "string"
  )
    return false;
  const program = TOKEN_PROGRAMS.get(account.owner);
  if (!program) return false;
  const data = object(account.data);
  const parsed = object(data?.parsed);
  const info = object(parsed?.info);
  if (
    !data ||
    data.program !== program ||
    parsed?.type !== "mint" ||
    !info ||
    info.isInitialized !== true ||
    typeof info.decimals !== "number" ||
    !Number.isSafeInteger(info.decimals) ||
    info.decimals < 0 ||
    info.decimals > 18 ||
    typeof info.supply !== "string" ||
    !/^(?:0|[1-9]\d{0,19})$/.test(info.supply)
  )
    return false;
  return BigInt(info.supply) <= BigInt("18446744073709551615");
}

/**
 * Read-only finalized ownership/type proof, not a token safety or price audit.
 * getMultipleAccounts preserves request order and supports jsonParsed:
 * https://solana.com/docs/rpc/http/getmultipleaccounts
 * https://solana.com/docs/rpc/json-structures#json-parsed
 * Parser schema (including Token-2022 extensions) is delegated to the RPC node:
 * https://github.com/anza-xyz/agave/blob/v3.1.8/account-decoder/src/parse_token.rs
 */
async function verifyMintAttempt(
  requested: readonly string[],
): Promise<Set<string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: RPC_ID,
        method: "getMultipleAccounts",
        params: [
          requested,
          { commitment: "finalized", encoding: "jsonParsed" },
        ],
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== RPC_URL)
    )
      throw new AttemptFailure("redirect");
    if (!response.ok)
      throw new AttemptFailure(
        tokenDataHttpFailure(response.status),
        tokenDataRetryDelay(response.headers.get("retry-after")),
      );
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES)
      throw new AttemptFailure("oversized-response");
    if (!response.body) throw new AttemptFailure("missing-response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES)
          throw new AttemptFailure("oversized-response");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const joined = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) {
      joined.set(chunk, position);
      position += chunk.byteLength;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(joined),
      ) as unknown;
    } catch {
      throw new AttemptFailure("invalid-json");
    }
    const envelope = object(decoded);
    const result = object(envelope?.result);
    const context = object(result?.context);
    if (
      !envelope ||
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== RPC_ID ||
      Object.hasOwn(envelope, "error") ||
      !result ||
      !context ||
      typeof context.slot !== "number" ||
      !Number.isSafeInteger(context.slot) ||
      context.slot < 0 ||
      !Array.isArray(result.value) ||
      result.value.length !== requested.length
    )
      throw new AttemptFailure("invalid-response");
    const values = result.value;
    return new Set(
      requested.filter((_mint, index) => initializedMint(values[index])),
    );
  } catch (error) {
    if (error instanceof AttemptFailure) throw error;
    throw new AttemptFailure(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
import {
  tokenDataFailureIsRetryable,
  tokenDataHttpFailure,
  tokenDataRetryDelay,
  type TokenDataErrorCode,
} from "./solana-tracker";

/** At most one transient read-only retry; mint eligibility is never relaxed. */
export async function verifySolanaMints(
  mints: readonly string[],
): Promise<Set<string>> {
  if (mints.length > 5 || mints.some((mint) => !address(mint)))
    throw new SolanaMintVerificationError("invalid-request");
  const requested = [...new Set(mints)];
  if (!requested.length) return new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await verifyMintAttempt(requested);
    } catch (error) {
      const failure =
        error instanceof AttemptFailure ? error : new AttemptFailure("network");
      if (
        attempt === 0 &&
        tokenDataFailureIsRetryable(failure.code) &&
        failure.retryDelay !== null
      ) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, failure.retryDelay!),
        );
        continue;
      }
      throw new SolanaMintVerificationError(failure.code);
    }
  }
  throw new SolanaMintVerificationError("network");
}
