import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  RESEARCH_AMOUNT,
  RESEARCH_ASSET,
  RESEARCH_NETWORK,
  RESEARCH_PRODUCT,
  RESEARCH_TREASURY,
  researchPaymentRequired,
  researchRequirements,
} from "../lib/forum-research";
import {
  createMockResearchOwnerExample,
  MOCK_OWNER_SESSION,
  MOCK_SIGNED_WIRE,
  MOCK_UNSIGNED_WIRE,
  type MockRequest,
} from "./research-owner-client.mock";

// No valid transaction, wallet client, RPC, facilitator or real credential exists.
const key = "a".repeat(64);
const wallet = "So11111111111111111111111111111111111111112";
const mint = "11111111111111111111111111111111";
const signature = "1".repeat(64); // Syntactically shaped, NOT a real receipt.
const frozenReport = Object.freeze({
  product: RESEARCH_PRODUCT,
  mint,
  generatedAt: 90_000,
  metricsAsOf: 80_000,
  facts: [{ label: "Price (USD)", value: "$0.01" }],
  analysis: [],
  sources: [],
  methodology: "Invented local frozen output, not provider data.",
});
let forbiddenNetwork: ReturnType<typeof vi.fn>;
beforeEach(() => {
  forbiddenNetwork = vi.fn(() => {
    throw new Error("All network is forbidden");
  });
  vi.stubGlobal("fetch", forbiddenNetwork);
  vi.stubGlobal("WebSocket", forbiddenNetwork);
});
afterEach(() => {
  expect(forbiddenNetwork).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
function fixture() {
  const state = {
    requests: [] as MockRequest[],
    approvals: 0,
    signOnly: 0,
    approve: true,
    now: 100_000,
    expiry: 400_000,
    enabled: true,
    catalogStatus: 200,
    quoteStatus: 402,
    prepareStatus: 200,
    result: "fulfilled" as
      | "fulfilled"
      | "protected"
      | "unknown"
      | "rejected"
      | "throw"
      | "bad-proof",
    changeDeclaration: (value: PaymentRequired) => value,
  };
  const payload = (declaration: PaymentRequired): PaymentPayload => ({
    x402Version: 2,
    resource: declaration.resource,
    accepted: declaration.accepts[0],
    payload: { transaction: MOCK_SIGNED_WIRE },
  });
  const options = {
    owner: { kind: "mock-human-owner" as const, session: MOCK_OWNER_SESSION },
    wallet,
    mint,
    idempotencyKey: "inert-request-key-001",
    now: () => state.now,
    async transport(request: MockRequest): Promise<Response> {
      state.requests.push(structuredClone(request));
      expect(request.headers.Authorization).toBe(
        `Bearer ${MOCK_OWNER_SESSION}`,
      );
      expect(request.path).toMatch(/^\/api\/research\//);
      if (request.path === "/api/research/catalog")
        return Response.json(
          {
            products: [
              {
                id: RESEARCH_PRODUCT,
                enabled: state.enabled,
                reason: state.enabled ? "ready" : "free_credits_exhausted",
                paymentProtocol: "x402-v2-exact",
                price: {
                  amount: RESEARCH_AMOUNT,
                  asset: RESEARCH_ASSET,
                  network: RESEARCH_NETWORK,
                  recipient: RESEARCH_TREASURY,
                },
              },
            ],
          },
          { status: state.catalogStatus },
        );
      if (request.path === "/api/research/token") {
        const declaration = state.changeDeclaration(
          researchPaymentRequired(key, researchRequirements(key, wallet)),
        );
        return Response.json(
          {
            intentKey: key,
            expiresAt: state.expiry,
            paymentRequired: declaration,
          },
          {
            status: state.quoteStatus,
            headers: {
              "PAYMENT-REQUIRED": encodePaymentRequiredHeader(declaration),
            },
          },
        );
      }
      if (request.path === "/api/research/prepare")
        return Response.json(
          { simulated: state.prepareStatus === 200 },
          { status: state.prepareStatus },
        );
      expect(request.path).toBe(`/api/research/token/${key}`);
      expect(request.method).toBe("GET");
      if (state.result === "throw") throw new Error("Inert transport failure");
      if (state.result === "protected" || state.result === "unknown")
        return Response.json(
          {
            state: state.result === "unknown" ? "unknown" : "verifying",
            intentKey: key,
          },
          { status: 202 },
        );
      if (state.result === "rejected")
        return Response.json({ state: "rejected" }, { status: 409 });
      return Response.json(
        {
          state: "fulfilled",
          intentKey: key,
          mint,
          signature,
          finalizedAt: 100_001,
          report: frozenReport,
        },
        {
          headers: {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({
              success: state.result !== "bad-proof",
              transaction: signature,
              network: RESEARCH_NETWORK,
              amount: RESEARCH_AMOUNT,
            }),
          },
        },
      );
    },
    async approve(
      review: Parameters<
        Parameters<typeof createMockResearchOwnerExample>[0]["approve"]
      >[0],
    ) {
      state.approvals++;
      expect(review).toEqual({
        intentKey: key,
        mint,
        wallet,
        expiresAt: state.expiry,
        product: RESEARCH_PRODUCT,
        amount: RESEARCH_AMOUNT,
        asset: RESEARCH_ASSET,
        network: RESEARCH_NETWORK,
        recipient: RESEARCH_TREASURY,
      });
      expect(Object.isFrozen(review)).toBe(true);
      return state.approve;
    },
    async mockSignOnly(
      input: Parameters<
        Parameters<typeof createMockResearchOwnerExample>[0]["mockSignOnly"]
      >[0],
    ) {
      state.signOnly++;
      expect(state.approvals).toBe(1);
      await input.prepare(MOCK_UNSIGNED_WIRE);
      return payload(input.declaration);
    },
  };
  const paymentCalls = () =>
    state.requests.filter((request) => request.headers["PAYMENT-SIGNATURE"]);
  return { state, options, payload, paymentCalls };
}

test("explicit owner approval, one prepared intent and official headers return only the frozen mocked report", async () => {
  const f = fixture();
  const example = createMockResearchOwnerExample(f.options);
  expect(f.state.requests).toEqual([]);
  expect(f.state.approvals + f.state.signOnly).toBe(0);
  const [result, repeated] = await Promise.all([
    example.reviewOnce(),
    example.reviewOnce(),
  ]);
  expect(result).toEqual({
    state: "mock-fulfilled",
    receiptPath: `/api/research/token/${key}`,
    frozenReport,
  });
  expect(repeated).toBe(result);
  expect(f.state.approvals).toBe(1);
  expect(f.state.signOnly).toBe(1);
  expect(f.state.requests.map(({ method, path }) => [method, path])).toEqual([
    ["GET", "/api/research/catalog"],
    ["POST", "/api/research/token"],
    ["POST", "/api/research/prepare"],
    ["GET", `/api/research/token/${key}`],
  ]);
  expect(f.state.requests[1].body).toEqual({
    wallet,
    mint,
    idempotencyKey: "inert-request-key-001",
  });
  expect(f.state.requests[2].body).toEqual({
    intentKey: key,
    transactionBase64: MOCK_UNSIGNED_WIRE,
  });
  expect(
    decodePaymentSignatureHeader(
      f.paymentCalls()[0].headers["PAYMENT-SIGNATURE"],
    ).payload,
  ).toEqual({ transaction: MOCK_SIGNED_WIRE });
});

test.each([401, 403, 503])(
  "catalog HTTP%s stops before quote or approval",
  async (status) => {
    const f = fixture();
    f.state.catalogStatus = status;
    expect(
      (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
    ).toBe("mock-stopped");
    expect(f.state.requests).toHaveLength(1);
    expect(f.state.approvals + f.state.signOnly).toBe(0);
  },
);

test("a truthy malformed settlement-success flag is not fulfillment", async () => {
  const f = fixture();
  const transport = f.options.transport;
  f.options.transport = async (request) => {
    const response = await transport(request);
    if (!request.headers["PAYMENT-SIGNATURE"]) return response;
    const malformed = {
      success: "true",
      transaction: signature,
      network: RESEARCH_NETWORK,
      amount: RESEARCH_AMOUNT,
    };
    return Response.json(await response.json(), {
      headers: {
        "PAYMENT-RESPONSE": btoa(JSON.stringify(malformed)),
      },
    });
  };
  expect(
    (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
  ).toBe("mock-protected");
  expect(f.paymentCalls()).toHaveLength(1);
});

test.each(["protected", "unknown", "throw", "rejected", "bad-proof"] as const)(
  "%s never claims fulfillment or automatically replays settlement",
  async (outcome) => {
    const f = fixture();
    f.state.result = outcome;
    const example = createMockResearchOwnerExample(f.options);
    expect((await example.reviewOnce()).state).toBe("mock-protected");
    expect((await example.reviewOnce()).state).toBe("mock-protected");
    expect(f.paymentCalls()).toHaveLength(1);
    expect(f.state.requests).toHaveLength(4);
    f.state.result = "fulfilled";
    const checked = await example.checkSavedReceipt();
    expect(checked.state).toBe("mock-fulfilled");
    expect(
      f.state.requests.at(-1)?.headers["PAYMENT-SIGNATURE"],
    ).toBeUndefined();
    expect(f.paymentCalls()).toHaveLength(1);
    expect(f.state.approvals).toBe(1);
    expect(f.state.signOnly).toBe(1);
  },
);

test("refused approval never prepares, signs or submits, and cannot be retried implicitly", async () => {
  const f = fixture();
  f.state.approve = false;
  const example = createMockResearchOwnerExample(f.options);
  expect((await example.reviewOnce()).state).toBe("mock-stopped");
  f.state.approve = true;
  await example.reviewOnce();
  expect((await example.checkSavedReceipt()).state).toBe("mock-stopped");
  expect(f.state.requests).toHaveLength(2);
  expect(f.state.signOnly).toBe(0);
});

test.each([401, 403, 409, 503])(
  "denied quote HTTP%s never reaches approval or wallet seams",
  async (status) => {
    const f = fixture();
    f.state.quoteStatus = status;
    expect(
      (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
    ).toBe("mock-stopped");
    expect(f.state.requests).toHaveLength(2);
    expect(f.state.approvals + f.state.signOnly).toBe(0);
  },
);

test("exhausted readiness never obtains a quote", async () => {
  const f = fixture();
  f.state.enabled = false;
  expect(
    (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
  ).toBe("mock-stopped");
  expect(f.state.requests).toHaveLength(1);
  expect(f.state.approvals + f.state.signOnly).toBe(0);
});

test("evidence-agent credentials are never used as an owner JWT", async () => {
  const f = fixture();
  const owner = {
    kind: "evidence-agent",
    session: "evidence-only-token",
  } as unknown as typeof f.options.owner;
  expect(
    (await createMockResearchOwnerExample({ ...f.options, owner }).reviewOnce())
      .state,
  ).toBe("mock-stopped");
  expect(f.state.requests).toEqual([]);
});

test.each([
  "asset",
  "amount",
  "network",
  "payTo",
  "memo",
  "resource",
  "version",
])("refuses changed %s before approval", async (field) => {
  const f = fixture();
  f.state.changeDeclaration = (value) => {
    if (field === "resource")
      value.resource!.url = "https://evil.invalid/report";
    else if (field === "version") value.x402Version = 1;
    else if (field === "memo") value.accepts[0].extra!.memo = "different";
    else Object.assign(value.accepts[0], { [field]: "different" });
    return value;
  };
  expect(
    (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
  ).toBe("mock-stopped");
  expect(f.state.approvals + f.state.signOnly).toBe(0);
  expect(f.paymentCalls()).toHaveLength(0);
});

test.each(["before", "during-approval", "during-prepare"])(
  "expiry %s cannot renew the quote or submit",
  async (stage) => {
    const f = fixture();
    if (stage === "before") f.state.now = f.state.expiry;
    if (stage === "during-approval")
      f.options.approve = async () => {
        f.state.now = f.state.expiry;
        return true;
      };
    if (stage === "during-prepare") {
      f.options.mockSignOnly = async (input) => {
        await input.prepare(MOCK_UNSIGNED_WIRE);
        f.state.now = f.state.expiry;
        return f.payload(input.declaration);
      };
    }
    expect(
      (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
    ).toBe("mock-stopped");
    expect(f.paymentCalls()).toHaveLength(0);
  },
);

test.each(["refused", "missing", "duplicate", "changed-payload"])(
  "%s preparation cannot reach settlement",
  async (mode) => {
    const f = fixture();
    if (mode === "refused") f.state.prepareStatus = 409;
    if (mode === "missing")
      f.options.mockSignOnly = async ({ declaration }) =>
        f.payload(declaration);
    if (mode === "duplicate")
      f.options.mockSignOnly = async ({ declaration, prepare }) => {
        await prepare(MOCK_UNSIGNED_WIRE);
        await prepare(MOCK_UNSIGNED_WIRE);
        return f.payload(declaration);
      };
    if (mode === "changed-payload")
      f.options.mockSignOnly = async ({ declaration, prepare }) => {
        await prepare(MOCK_UNSIGNED_WIRE);
        return {
          ...f.payload(declaration),
          resource: { url: "https://evil.invalid" },
        };
      };
    expect(
      (await createMockResearchOwnerExample(f.options).reviewOnce()).state,
    ).toBe("mock-stopped");
    expect(f.paymentCalls()).toHaveLength(0);
  },
);

test("missing transport never falls back to global fetch", async () => {
  const f = fixture();
  expect(
    (
      await createMockResearchOwnerExample({
        ...f.options,
        transport: undefined as unknown as typeof f.options.transport,
      }).reviewOnce()
    ).state,
  ).toBe("mock-stopped");
});
