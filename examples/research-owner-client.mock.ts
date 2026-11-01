/** Offline protocol rehearsal, NOT a payment client. Never replace its seams
 * with fetch or a wallet. Fake credentials and wire bytes cannot authorize pay. */
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  canonicalJson,
  exactResearchPayload,
  RESEARCH_AMOUNT,
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  RESEARCH_PRODUCT,
  RESEARCH_TREASURY,
  researchPaymentRequired,
  researchRequirements,
  researchResource,
  researchSignatureValid,
} from "../lib/forum-research";
import { isSolanaAddress, record } from "../lib/forum-commerce";

export const MOCK_OWNER_SESSION = "inert-owner-session-not-a-real-jwt" as const;
export const MOCK_UNSIGNED_WIRE = "AAAA" as const; // Not a Solana transaction.
export const MOCK_SIGNED_WIRE = "AQAA" as const; // Not a signed transaction.
export type MockRequest = {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: Record<string, string>;
};
export type MockTransport = (request: MockRequest) => Promise<Response>;
export type MockReview = Readonly<{
  intentKey: string;
  mint: string;
  wallet: string;
  expiresAt: number;
  product: typeof RESEARCH_PRODUCT;
  amount: typeof RESEARCH_AMOUNT;
  asset: typeof RESEARCH_ASSET;
  network: typeof RESEARCH_NETWORK;
  recipient: typeof RESEARCH_TREASURY;
}>;
export type MockOutcome =
  | { state: "mock-stopped"; reason: string }
  | { state: "mock-protected"; receiptPath: string }
  | { state: "mock-fulfilled"; receiptPath: string; frozenReport: unknown };
type Options = {
  owner: { kind: "mock-human-owner"; session: typeof MOCK_OWNER_SESSION };
  wallet: string;
  mint: string;
  idempotencyKey: string;
  now: () => number;
  transport: MockTransport;
  approve: (review: MockReview) => Promise<boolean>;
  mockSignOnly: (input: {
    declaration: PaymentRequired;
    prepare: (wire: typeof MOCK_UNSIGNED_WIRE) => Promise<void>;
  }) => Promise<PaymentPayload>;
};

export function createMockResearchOwnerExample(options: Options) {
  const { wallet, mint, idempotencyKey } = options;
  const headers = { Authorization: `Bearer ${MOCK_OWNER_SESSION}` };
  let receiptPath: string | null = null;
  let intentKey: string | null = null;
  let settlementAttempted = false;
  let run: Promise<MockOutcome> | undefined;
  const stopped = (reason: string): MockOutcome => ({
    state: "mock-stopped",
    reason,
  });
  const protectedResult = (): MockOutcome => ({
    state: "mock-protected",
    receiptPath: receiptPath!,
  });

  async function receipt(response: Response): Promise<MockOutcome> {
    if (response.status === 202) return protectedResult();
    if (response.status !== 200) return protectedResult();
    const row = record(await response.json());
    const report = record(row.report);
    const proof = decodePaymentResponseHeader(
      response.headers.get("PAYMENT-RESPONSE") ?? "",
    );
    if (
      row.state !== "fulfilled" ||
      row.intentKey !== intentKey ||
      row.mint !== mint ||
      typeof row.signature !== "string" ||
      !researchSignatureValid(row.signature) ||
      proof.success !== true ||
      proof.transaction !== row.signature ||
      proof.network !== RESEARCH_NETWORK ||
      proof.amount !== RESEARCH_AMOUNT ||
      report.product !== RESEARCH_PRODUCT ||
      report.mint !== mint
    )
      return protectedResult();
    // This is the server-returned frozen object, never regenerated or retimed.
    // Even this outcome is MOCKED, not independent evidence of real finality.
    return {
      state: "mock-fulfilled",
      receiptPath: receiptPath!,
      frozenReport: row.report,
    };
  }

  async function review(): Promise<MockOutcome> {
    if (
      options.owner?.kind !== "mock-human-owner" ||
      options.owner.session !== MOCK_OWNER_SESSION ||
      !isSolanaAddress(wallet) ||
      !isSolanaAddress(mint) ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)
    )
      return stopped(
        "Mock human-owner context required; evidence-agent grants cannot authorize spending.",
      );
    try {
      const catalog = await options.transport({
        method: "GET",
        path: "/api/research/catalog",
        headers,
      });
      if (catalog.status !== 200)
        return stopped("Catalog unavailable; no payment attempted.");
      const products = record(await catalog.json()).products;
      const product = record(
        Array.isArray(products)
          ? products.find((item) => record(item).id === RESEARCH_PRODUCT)
          : null,
      );
      const price = record(product.price);
      if (
        product.enabled !== true ||
        product.reason !== "ready" ||
        product.paymentProtocol !== "x402-v2-exact" ||
        price.amount !== RESEARCH_AMOUNT ||
        price.asset !== RESEARCH_ASSET ||
        price.network !== RESEARCH_NETWORK ||
        price.recipient !== RESEARCH_TREASURY
      )
        return stopped(
          "Product/readiness unavailable; no quote or payment attempted.",
        );

      const quoted = await options.transport({
        method: "POST",
        path: "/api/research/token",
        headers: { ...headers, "Content-Type": "application/json" },
        body: { wallet, mint, idempotencyKey },
      });
      if (quoted.status !== 402)
        return stopped("Quote refused; no payment attempted.");
      const body = record(await quoted.json());
      if (
        typeof body.intentKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.intentKey)
      )
        return stopped("Quote identity unavailable; no payment attempted.");
      const deadline = body.expiresAt;
      const currentQuote = () => {
        const now = options.now();
        return (
          typeof deadline === "number" &&
          Number.isSafeInteger(deadline) &&
          Number.isSafeInteger(now) &&
          now > 0 &&
          deadline > now
        );
      };
      if (!currentQuote())
        return stopped("Quote expired or invalid; no payment attempted.");
      const declaration = decodePaymentRequiredHeader(
        quoted.headers.get("PAYMENT-REQUIRED") ?? "",
      );
      const feePayer = record(declaration.accepts?.[0]?.extra).feePayer;
      if (typeof feePayer !== "string")
        return stopped("Quote declaration refused.");
      const requirements = researchRequirements(body.intentKey, feePayer);
      const expected = researchPaymentRequired(body.intentKey, requirements);
      if (
        canonicalJson(declaration) !== canonicalJson(expected) ||
        canonicalJson(body.paymentRequired) !== canonicalJson(expected)
      )
        return stopped("Quote declaration refused.");
      intentKey = body.intentKey;
      receiptPath = new URL(researchResource(intentKey)).pathname;
      const approved = await options.approve(
        Object.freeze({
          intentKey,
          wallet,
          mint,
          expiresAt: deadline as number,
          product: RESEARCH_PRODUCT,
          amount: RESEARCH_AMOUNT,
          asset: RESEARCH_ASSET,
          network: RESEARCH_NETWORK,
          recipient: RESEARCH_TREASURY,
        }),
      );
      if (approved !== true || !currentQuote())
        return stopped(
          "Approval declined or quote expired; no payment attempted.",
        );
      let prepareCalls = 0;
      let prepared = false;
      const payload = await options.mockSignOnly({
        declaration: structuredClone(expected),
        prepare: async (wire) => {
          if (
            ++prepareCalls !== 1 ||
            wire !== MOCK_UNSIGNED_WIRE ||
            !currentQuote()
          )
            throw new Error("Mock prepare refused");
          const simulated = await options.transport({
            method: "POST",
            path: "/api/research/prepare",
            headers: { ...headers, "Content-Type": "application/json" },
            body: { intentKey: intentKey!, transactionBase64: wire },
          });
          if (
            simulated.status !== 200 ||
            record(await simulated.json()).simulated !== true
          )
            throw new Error("Mock prepare refused");
          prepared = true;
        },
      });
      if (
        !prepared ||
        prepareCalls !== 1 ||
        !currentQuote() ||
        exactResearchPayload(payload, requirements, expected.resource!.url) !==
          MOCK_SIGNED_WIRE
      )
        return stopped("Preparation/payload refused; no settlement attempted.");
      settlementAttempted = true; // Fence BEFORE I/O, even if the mock throws.
      return await receipt(
        await options.transport({
          method: "GET",
          path: receiptPath,
          headers: {
            ...headers,
            "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
          },
        }),
      );
    } catch {
      return settlementAttempted
        ? protectedResult()
        : stopped(
            "Mock preparation unavailable or declined; no settlement attempted.",
          );
    }
  }

  return {
    // Cache one promise: concurrent/repeated calls do not obtain another intent,
    // ask for approval twice, or replay an uncertain settlement.
    reviewOnce: () => (run ??= review()),
    async checkSavedReceipt(): Promise<MockOutcome> {
      if (!settlementAttempted || !receiptPath)
        return stopped("No settlement attempt to check.");
      try {
        // Explicit read only. NEVER attach PAYMENT-SIGNATURE here.
        return await receipt(
          await options.transport({
            method: "GET",
            path: receiptPath,
            headers,
          }),
        );
      } catch {
        return protectedResult();
      }
    },
  };
}
