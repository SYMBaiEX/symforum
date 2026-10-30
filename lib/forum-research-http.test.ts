import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./server-convex-auth", () => ({
  getAuthenticatedServerConvexClient: vi.fn(async () => null),
}));
import {
  researchCatalogHttp,
  researchPrepareHttp,
  researchQuoteHttp,
  researchResourceHttp,
  researchRpcHttp,
} from "./forum-research-http";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
test("catalog is explicit about owner authentication, no automatic payment and unchanged free content", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  const response = await researchCatalogHttp();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.products[0]).toMatchObject({
    enabled: false,
    paymentProtocol: "x402-v2-exact",
    freeContentUnchanged: true,
    price: { amount: "100000", symbol: "USDC" },
  });
  expect(body.products[0].authentication).toContain(
    "evidence-only agent grants do not authorize spending",
  );
});
test("cross-origin browser requests cannot request payments or use the preparation RPC proxy", async () => {
  const options = {
    method: "POST",
    headers: {
      origin: "https://other.example",
      "content-type": "application/json",
    },
    body: "{}",
  };
  for (const handle of [
    researchQuoteHttp,
    researchPrepareHttp,
    researchRpcHttp,
  ])
    expect(
      (
        await handle(
          new Request("https://forum.symbaiex.com/api/research/token", options),
        )
      ).status,
    ).toBe(403);
  const response = await researchResourceHttp(
    new Request(
      `https://forum.symbaiex.com/api/research/token/${"a".repeat(64)}`,
      {
        headers: {
          origin: "https://other.example",
          "payment-signature": "untrusted",
        },
      },
    ),
    "a".repeat(64),
  );
  expect(response.status).toBe(403);
});
test("streamed oversized request and invalid/anonymous receipt do not reach backend payment", async () => {
  const request = new Request("https://forum.symbaiex.com/api/research/token", {
    method: "POST",
    headers: {
      origin: "https://forum.symbaiex.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ padding: "x".repeat(5000) }),
  });
  expect((await researchQuoteHttp(request)).status).toBe(409);
  expect(
    (
      await researchResourceHttp(
        new Request("https://forum.symbaiex.com/api/research/token/nope"),
        "nope",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await researchResourceHttp(
        new Request(
          `https://forum.symbaiex.com/api/research/token/${"a".repeat(64)}`,
        ),
        "a".repeat(64),
      )
    ).status,
  ).toBe(401);
});
