import { afterEach, describe, expect, test, vi } from "vitest";

import { getBrowserStorage } from "./browser-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser storage", () => {
  test("returns null when a sandboxed window throws on property access", () => {
    const sandboxedWindow = {};
    Object.defineProperty(sandboxedWindow, "localStorage", {
      get() {
        throw new DOMException("Blocked by sandbox", "SecurityError");
      },
    });
    vi.stubGlobal("window", sandboxedWindow);

    expect(getBrowserStorage("localStorage")).toBeNull();
  });

  test("returns available browser storage", () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: storage });

    expect(getBrowserStorage("localStorage")).toBe(storage);
  });
});
