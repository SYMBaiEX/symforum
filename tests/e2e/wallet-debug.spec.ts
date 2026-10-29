import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createWalletDebugHandler } from "../manual/wallet-debug-server";

test("local real-SDK and direct-provider controls isolate connection failures without authentication or external traffic", async ({
  page,
}) => {
  const javascript = execFileSync(
    "bun",
    [
      "-e",
      `
    const r = await Bun.build({entrypoints:["tests/manual/wallet-debug.tsx"],target:"browser",format:"iife",minify:true,define:{"process.env":JSON.stringify({NODE_ENV:"production"})}});
    if(!r.success) throw Error(r.logs.join("\\n"));
    process.stdout.write(await r.outputs[0].text());
  `,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const origin = "http://127.0.0.1:43193";
  const handler = createWalletDebugHandler(origin, javascript);
  const authentication: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      external.push(url.origin);
      return route.abort();
    }
    if (url.pathname.startsWith("/api/")) authentication.push(url.pathname);
    const response = await handler(
      new Request(request.url(), {
        method: request.method(),
        headers: { ...(await request.allHeaders()), host: url.host },
        ...(request.method() === "POST" ? { body: request.postData() } : {}),
      }),
    );
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.addInitScript(() => {
    const failure = () => {
      throw Object.assign(new Error("PRIVATE-PROVIDER-BODY"), { code: -32603 });
    };
    Object.defineProperty(window, "ethereum", {
      get() {
        throw Error("Ethereum accessed by a Solana-only diagnostic");
      },
    });
    Object.assign(window, {
      phantom: { solana: { isPhantom: true, connect: async () => failure() } },
    });
    const wallet = {
      name: "Phantom",
      version: "1.0.0",
      icon: "data:image/svg+xml;base64,PHN2Zy8+",
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "standard:connect": {
          version: "1.0.0",
          connect: async () => failure(),
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async () => {
            throw Error("Signature must never be requested");
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      (
        event as CustomEvent<{ register: (wallet: unknown) => void }>
      ).detail.register(wallet);
    });
  });
  await page.goto(origin + "/?walletDebug=1");
  await expect(
    page.getByRole("heading", { name: "Local Solana Kit diagnostics" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect Phantom", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Connection failed");
  const read = async () =>
    JSON.parse(
      (await page.getByLabel("Wallet diagnostics").textContent()) ?? "[]",
    );
  expect((await read()).at(-1)).toMatchObject({
    lane: "minimal",
    stage: "failed",
    phase: "connect",
    errorCode: -32603,
  });
  await page
    .getByRole("button", { name: "Phantom provider control", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect Phantom directly" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Direct Phantom provider connection failed",
  );
  expect((await read()).at(-1)).toMatchObject({
    lane: "provider",
    stage: "failed",
    phase: "connect",
    errorCode: -32603,
  });
  expect(JSON.stringify(await read())).not.toContain("PRIVATE-PROVIDER-BODY");
  expect(authentication).toEqual([]);
  expect(external).toEqual([]);
  await page
    .getByRole("button", { name: "Full sign-in component", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Solana wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Phantom Installed" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "internal connection error",
  );
  expect((await read()).at(-1)).toMatchObject({
    lane: "signin",
    stage: "failed",
    phase: "connect",
    errorCode: -32603,
  });
  expect(authentication).toEqual([]);
  expect(external).toEqual([]);
});
