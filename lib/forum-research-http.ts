import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { getAuthenticatedServerConvexClient } from "./server-convex-auth";
import {
  RESEARCH_AMOUNT,
  RESEARCH_NETWORK,
  researchPaymentRequired,
  RESEARCH_ASSET,
  RESEARCH_PRODUCT,
  RESEARCH_TREASURY,
} from "./forum-research";
import type { ResearchReport, ResearchState } from "./forum-research";
import {
  researchReportCsp,
  researchReportHtml,
  researchReportUnavailableHtml,
} from "./forum-research-report-html";

type Receipt = {
  intentKey: string;
  mint: string;
  state: ResearchState;
  createdAt: number;
  expiresAt: number;
  signature: string | null;
  finalizedAt: number | null;
  report: ResearchReport | null;
};
const statusRef = makeFunctionReference<
  "query",
  { intentKey: string },
  Receipt
>("forumResearch:status");
const challengeRef = makeFunctionReference<
  "query",
  { intentKey: string; now: number },
  { requirementsJson: string; resource: string; expiresAt: number }
>("forumResearch:challenge");
const payRef = makeFunctionReference<
  "action",
  { intentKey: string; paymentHeader: string },
  { state: "protected" | "rejected" | "fulfilled"; signature: string | null }
>("forumResearchActions:pay");
const rpcRef = makeFunctionReference<
  "action",
  { intentKey: string; method: "getAccountInfo" | "getLatestBlockhash" },
  string
>("forumResearchActions:sdkRead");
const quoteRef = makeFunctionReference<
  "action",
  { wallet: string; mint: string; idempotencyKey: string },
  {
    intentKey: string;
    expiresAt: number;
    requirementsJson: string;
    resource: string;
  }
>("forumResearchActions:quote");
const configRef = makeFunctionReference<
  "query",
  { now: number },
  { enabled: boolean; reason: string }
>("forumResearch:getConfig");
const simulateRef = makeFunctionReference<
  "action",
  { intentKey: string; transactionBase64: string },
  null
>("forumResearchActions:simulate");
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Authorization, PAYMENT-SIGNATURE",
};
async function auth(request: Request) {
  const bearer = request.headers.get("authorization");
  if (bearer) {
    if (!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(bearer)) return null;
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    const client = new ConvexHttpClient(url);
    client.setAuth(bearer.slice(7));
    return client;
  }
  return await getAuthenticatedServerConvexClient();
}
function canPay(request: Request) {
  return (
    request.headers.has("authorization") ||
    request.headers.get("origin") === new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "same-origin"
  );
}
async function boundedRequest(request: Request, limit = 4096) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request");
  return body as Record<string, unknown>;
}
export async function researchCatalogHttp() {
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    const config = url
      ? await new ConvexHttpClient(url).query(configRef, { now: Date.now() })
      : null;
    return Response.json(
      {
        version: 1,
        products: [
          {
            id: RESEARCH_PRODUCT,
            description:
              "Timestamped token metrics, liquidity/turnover analysis, source citations and JSON export",
            price: {
              amount: RESEARCH_AMOUNT,
              asset: RESEARCH_ASSET,
              decimals: 6,
              symbol: "USDC",
              network: RESEARCH_NETWORK,
              recipient: RESEARCH_TREASURY,
            },
            paymentProtocol: "x402-v2-exact",
            enabled: config?.enabled ?? false,
            reason: config?.reason ?? "setup_required",
            quoteEndpoint: "/api/research/token",
            quoteMethod: "POST",
            resourceMethod: "GET",
            authentication:
              "Better Auth session or owner session bearer JWT, with a verified linked Solana wallet. Existing evidence-only agent grants do not authorize spending.",
            paymentApproval:
              "Explicit one-purchase wallet approval; no automatic charges",
            fulfillment:
              "Frozen before payment; accessible only after exact finalized payment proof",
            uncertainOutcome: "Protected receipt; never resettle automatically",
            refundPolicy:
              "No automatic refunds; contact support for a verified settled-but-undelivered payment",
            freeContentUnchanged: true,
          },
        ],
      },
      { headers: { ...privateHeaders } },
    );
  } catch {
    return Response.json(
      { version: 1, products: [], error: "Research catalog unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}
export async function researchQuoteHttp(request: Request) {
  if (!canPay(request))
    return Response.json(
      { error: "Use an authenticated research client." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const input = await boundedRequest(request),
      client = await auth(request);
    if (
      !client ||
      typeof input.wallet !== "string" ||
      typeof input.mint !== "string" ||
      typeof input.idempotencyKey !== "string"
    )
      throw new Error("Invalid request");
    const quote = await client.action(quoteRef, {
      wallet: input.wallet,
      mint: input.mint,
      idempotencyKey: input.idempotencyKey,
    });
    const required = researchPaymentRequired(
      quote.intentKey,
      JSON.parse(quote.requirementsJson) as PaymentRequirements,
    );
    return Response.json(
      {
        intentKey: quote.intentKey,
        expiresAt: quote.expiresAt,
        paymentRequired: required,
      },
      {
        status: 402,
        headers: {
          ...privateHeaders,
          "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Fresh citable coverage or payment readiness unavailable. No payment was requested.",
      },
      { status: 409, headers: privateHeaders },
    );
  }
}
export async function researchPrepareHttp(request: Request) {
  if (!canPay(request))
    return Response.json(
      { error: "Use an authenticated research client." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const input = await boundedRequest(request),
      client = await auth(request);
    if (
      !client ||
      typeof input.intentKey !== "string" ||
      typeof input.transactionBase64 !== "string"
    )
      throw new Error("Invalid request");
    await client.action(simulateRef, {
      intentKey: input.intentKey,
      transactionBase64: input.transactionBase64,
    });
    return Response.json({ simulated: true }, { headers: privateHeaders });
  } catch {
    return Response.json(
      {
        error:
          "Exact payment simulation did not pass. No settlement was requested.",
      },
      { status: 409, headers: privateHeaders },
    );
  }
}
/** Opt-in exact resource only. No middleware around existing free routes. */
export async function researchResourceHttp(
  request: Request,
  intentKey: string,
) {
  if (!/^[a-f0-9]{64}$/.test(intentKey))
    return Response.json(
      { error: "Research receipt unavailable." },
      { status: 404, headers: privateHeaders },
    );
  const paymentHeader = request.headers.get("payment-signature");
  if (paymentHeader && (!canPay(request) || paymentHeader.length > 8192))
    return Response.json(
      { error: "Payment request rejected." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const client = await auth(request);
    if (!client)
      return Response.json(
        { error: "Sign in to access your research receipt." },
        { status: 401, headers: privateHeaders },
      );
    if (paymentHeader)
      await client.action(payRef, { intentKey, paymentHeader });
    const receipt = await client.query(statusRef, { intentKey });
    if (receipt.state === "fulfilled" && receipt.report && receipt.signature) {
      return Response.json(receipt, {
        headers: {
          ...privateHeaders,
          "PAYMENT-RESPONSE": encodePaymentResponseHeader({
            success: true,
            transaction: receipt.signature,
            network: RESEARCH_NETWORK,
            amount: RESEARCH_AMOUNT,
          }),
        },
      });
    }
    if (receipt.state === "quoted" && receipt.expiresAt > Date.now()) {
      const quote = await client.query(challengeRef, {
        intentKey,
        now: Date.now(),
      });
      const required = researchPaymentRequired(
        intentKey,
        JSON.parse(quote.requirementsJson) as PaymentRequirements,
      );
      return Response.json(
        { receipt, paymentRequired: required },
        {
          status: 402,
          headers: {
            ...privateHeaders,
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
          },
        },
      );
    }
    return Response.json(receipt, {
      status: ["unknown", "verifying", "settlement_claimed"].includes(
        receipt.state,
      )
        ? 202
        : 409,
      headers: privateHeaders,
    });
  } catch {
    // Never reflect provider errors, signed wires, private report context or credentials.
    return Response.json(
      {
        error:
          "Research receipt unavailable. If payment approval began, check the saved receipt; do not repeat payment.",
      },
      { status: 409, headers: privateHeaders },
    );
  }
}
export async function researchRpcHttp(request: Request) {
  if (!canPay(request))
    return Response.json(
      { error: "Use your signed-in research request." },
      { status: 403, headers: privateHeaders },
    );
  try {
    const row = await boundedRequest(request);
    const intentKey = new URL(request.url).searchParams.get("intentKey") ?? "";
    if (
      !/^[a-f0-9]{64}$/.test(intentKey) ||
      row.jsonrpc !== "2.0" ||
      !["number", "string"].includes(typeof row.id) ||
      (row.method !== "getAccountInfo" && row.method !== "getLatestBlockhash")
    )
      throw new Error("Invalid RPC");
    const params = row.params;
    if (
      !Array.isArray(params) ||
      params.length > 2 ||
      (row.method === "getAccountInfo" &&
        params[0] !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    )
      throw new Error("Invalid RPC");
    const client = await auth(request);
    if (!client) throw new Error("Unauthorized");
    const result = await client.action(rpcRef, {
      intentKey,
      method: row.method,
    });
    return Response.json(
      { jsonrpc: "2.0", id: row.id, result: JSON.parse(result) as unknown },
      { headers: privateHeaders },
    );
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message:
            "Research preparation unavailable within the current allowance.",
        },
      },
      { status: 400, headers: privateHeaders },
    );
  }
}

/** Human reader only: never delegate to the payment-capable resource handler. */
export async function researchReportViewHttp(request: Request, intentKey: string) {
  const nonce = request.headers.get("x-nonce");
  const headers = {
    ...privateHeaders,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": await researchReportCsp(),
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
  const unavailable = (status: number, extra?: Record<string, string>) =>
    new Response(researchReportUnavailableHtml(nonce), {
      status,
      headers: { ...headers, ...extra },
    });
  if (request.method !== "GET") return unavailable(405, { Allow: "GET" });
  if (request.headers.has("PAYMENT-SIGNATURE")) return unavailable(403);
  if (!/^[a-f0-9]{64}$/.test(intentKey)) return unavailable(404);
  try {
    const client = await auth(request);
    if (!client) return unavailable(401);
    // The existing backend query resolves the actual current human principal
    // and saved owner. Query/Host/claim headers cannot establish ownership.
    const receipt = await client.query(statusRef, { intentKey });
    if (receipt.state !== "fulfilled" || !receipt.report || !receipt.signature)
      return unavailable(
        ["unknown", "verifying", "settlement_claimed"].includes(receipt.state)
          ? 202
          : 409,
      );
    if (
      receipt.intentKey !== intentKey ||
      receipt.report.mint !== receipt.mint ||
      receipt.report.product !== RESEARCH_PRODUCT
    )
      return unavailable(409);
    return new Response(
      researchReportHtml(
        {
          ...receipt,
          signature: receipt.signature,
          report: receipt.report,
        },
        nonce,
      ),
      { headers },
    );
  } catch {
    // No provider/backend bodies, report fragments or existence hints on denial.
    return unavailable(409);
  }
}
