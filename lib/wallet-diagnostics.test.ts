import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearWalletDiagnostics,
  createWalletDiagnostic,
  getWalletDiagnostics,
  subscribeWalletDiagnostics,
} from "./wallet-diagnostics";

beforeEach(() => {
  const browser = {
    location: { search: "?walletDebug=1" },
    isSecureContext: true,
    top: null as unknown,
  };
  browser.top = browser;
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  vi.spyOn(console, "info").mockImplementation(() => {});
  clearWalletDiagnostics();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("diagnostics are opt-in and never emit or retain data by default", () => {
  window.location.search = "";
  const report = createWalletDiagnostic("Phantom");
  report.record("connect_requested");
  report.failure("connect", { code: -32603 });
  expect(getWalletDiagnostics()).toEqual([]);
  expect(console.info).not.toHaveBeenCalled();
});

test("only allowlisted metadata survives hostile provider bodies and extra fields", () => {
  const privateText = "PRIVATE-WALLET-ADDRESS-NONCE-SIGNATURE-SESSION";
  const report = createWalletDiagnostic(privateText);
  report.record("selected", {
    accountCount: 1000,
    canSignMessage: true,
    sdkStatus: privateText,
    address: privateText,
  } as Parameters<typeof report.record>[1]);
  report.failure("connect", {
    code: -32603,
    message: privateText,
    signature: privateText,
    stack: privateText,
  });
  expect(getWalletDiagnostics()).toEqual([
    expect.objectContaining({
      wallet: "Other",
      stage: "selected",
      accountCount: 100,
      canSignMessage: true,
    }),
    expect.objectContaining({
      wallet: "Other",
      stage: "failed",
      phase: "connect",
      errorCode: -32603,
    }),
  ]);
  expect(JSON.stringify(getWalletDiagnostics())).not.toContain(privateText);
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
    privateText,
  );
});

test("nested numeric provider code is retained, without error messages", () => {
  createWalletDiagnostic("Phantom").failure(
    "connect",
    new Error("private", { cause: { code: -32603, message: "private" } }),
  );
  expect(getWalletDiagnostics()[0]).toMatchObject({ errorCode: -32603 });
  expect(JSON.stringify(getWalletDiagnostics())).not.toContain("private");
});

test("throwing provider getters and console/listeners cannot break the wallet flow", () => {
  const off = subscribeWalletDiagnostics(() => {
    throw Error("observer");
  });
  vi.mocked(console.info).mockImplementation(() => {
    throw Error("console");
  });
  const error = Object.defineProperty({}, "code", {
    get() {
      throw Error("private");
    },
  });
  expect(() =>
    createWalletDiagnostic("Phantom").failure("connect", error),
  ).not.toThrow();
  off();
  expect(getWalletDiagnostics()[0]).toMatchObject({
    phase: "connect",
    stage: "failed",
  });
  expect(getWalletDiagnostics()[0]).not.toHaveProperty("errorCode");
});

test("logs are immutable, bounded, observable and clearable without wallet operations", () => {
  const changed = vi.fn();
  const off = subscribeWalletDiagnostics(changed);
  const report = createWalletDiagnostic("Phantom", "minimal");
  for (let i = 0; i < 105; i++) report.record("connect_requested");
  expect(getWalletDiagnostics()).toHaveLength(100);
  expect(Object.isFrozen(getWalletDiagnostics())).toBe(true);
  expect(Object.isFrozen(getWalletDiagnostics()[0])).toBe(true);
  expect(changed).toHaveBeenCalledTimes(105);
  clearWalletDiagnostics();
  expect(getWalletDiagnostics()).toEqual([]);
  off();
});
