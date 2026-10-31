import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import { rpcCreditCost } from "../lib/forum-read-policy";
import {
  ProviderAdmissionError,
  type MeteredProvider,
} from "../lib/provider-admission-error";
export { ProviderAdmissionError } from "../lib/provider-admission-error";
export type { MeteredProvider } from "../lib/provider-admission-error";

export type ProviderAdmission =
  | { ok: true; reason: null; retryAt: null }
  | {
      ok: false;
      reason: "burst" | "daily" | "rolling";
      retryAt: number;
    };

const admit = makeFunctionReference<
  "mutation",
  { provider: MeteredProvider; credits: number },
  ProviderAdmission
>("forumProviderAdmission:admit");

function canonicalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("A secure provider URL is required.");
  return url.toString();
}

function waitBeforeIo(delay: number, signal?: AbortSignal | null) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Admission wraps an existing transport; it neither retries nor modifies the
 * request/response. Existing Jupiter/Tracker and operation gates remain owners
 * of their policies. All configured Solana endpoints share one conservative
 * application RPC allowance, including independent proof providers.
 */
export function providerFetch(
  ctx: Pick<ActionCtx, "runMutation">,
  options: { rpcUrls?: readonly string[]; fetcher?: typeof fetch } = {},
): typeof fetch {
  const rpcUrls = new Set((options.rpcUrls ?? []).map(canonicalUrl));
  const fetcher = options.fetcher ?? fetch;
  return async (input, init) => {
    const startedAt = Date.now();
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl);
    let provider: MeteredProvider | null = null;
    let credits = 1;
    if (rpcUrls.has(url.toString())) {
      provider = "helius";
      // Only the bounded single JSON-RPC requests used by existing transports
      // are metered. An unknown/batched body cannot receive an assumed cost.
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const body = init?.body;
      if (
        method.toUpperCase() !== "POST" ||
        typeof body !== "string" ||
        body.length > 2_000_000
      )
        throw new ProviderAdmissionError(provider, "invalid-request", null);
      let rpc: unknown;
      try {
        rpc = JSON.parse(body);
      } catch {
        throw new ProviderAdmissionError(provider, "invalid-request", null);
      }
      if (
        !rpc ||
        typeof rpc !== "object" ||
        Array.isArray(rpc) ||
        !("jsonrpc" in rpc) ||
        rpc.jsonrpc !== "2.0" ||
        !("method" in rpc) ||
        typeof rpc.method !== "string" ||
        !("params" in rpc) ||
        !Array.isArray(rpc.params) ||
        !("id" in rpc) ||
        (typeof rpc.id !== "number" && typeof rpc.id !== "string")
      )
        throw new ProviderAdmissionError(provider, "invalid-request", null);
      const cost = rpcCreditCost(rpc.method);
      if (cost === null)
        throw new ProviderAdmissionError(provider, "invalid-request", null);
      credits = cost;
    } else if (url.hostname === "api.dexscreener.com") {
      provider = "dexscreener";
    } else if (url.hostname === "api.geckoterminal.com") {
      provider = "geckoterminal";
    }
    if (provider) {
      // Do not accept credentialed URLs, HTTP, fragments or alternate ports on
      // otherwise allowlisted hosts. Existing callers use fixed HTTPS hosts.
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.port
      )
        throw new ProviderAdmissionError(provider, "invalid-request", null);
      let result = await ctx.runMutation(admit, { provider, credits });
      // Multi-read preparation/proof workflows may encounter the conservative
      // per-second RPC envelope. Wait only BEFORE any transport has started,
      // retaining the original request, signal and business expiry. Never wait
      // on daily/rolling limits or retry an uncertain upstream operation.
      for (
        let check = 0;
        !result.ok &&
        provider === "helius" &&
        result.reason === "burst" &&
        check < 2;
        check++
      ) {
        const delay = result.retryAt - Date.now();
        if (delay <= 0 || delay > 2000 || Date.now() - startedAt + delay > 2500)
          break;
        await waitBeforeIo(delay, signal);
        signal?.throwIfAborted();
        result = await ctx.runMutation(admit, { provider, credits });
      }
      if (!result.ok)
        throw new ProviderAdmissionError(
          provider,
          result.reason,
          result.retryAt,
        );
    }
    signal?.throwIfAborted();
    return fetcher(input, init);
  };
}
