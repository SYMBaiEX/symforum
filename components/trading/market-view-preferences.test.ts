import { describe, expect, test } from "vitest";
import {
  forgetMarketViewPreferences,
  MARKET_VIEW_STORAGE_KEY,
  parseMarketViewPreferences,
  readMarketViewPreferences,
  saveMarketViewPreferences,
  type MarketViewPreferences,
} from "./market-view-preferences";

const view: MarketViewPreferences = {
  band: "50k100k",
  platform: "pumpfun",
  freshOnly: true,
  sortKey: "price",
  sortDirection: "asc",
};
const raw = JSON.stringify({ version: 1, ...view });
function storage(initial: string | null = null) {
  let bytes = initial;
  const calls: string[] = [];
  return {
    calls,
    bytes: () => bytes,
    getItem(key: string) {
      expect(key).toBe(MARKET_VIEW_STORAGE_KEY);
      calls.push("get");
      return bytes;
    },
    setItem(key: string, value: string) {
      expect(key).toBe(MARKET_VIEW_STORAGE_KEY);
      calls.push("set");
      bytes = value;
    },
    removeItem(key: string) {
      expect(key).toBe(MARKET_VIEW_STORAGE_KEY);
      calls.push("remove");
      bytes = null;
    },
  };
}
test("valid public controls round-trip without private caller fields", () => {
  const local = storage();
  expect(
    saveMarketViewPreferences(local, {
      ...view,
      wallet: "PRIVATE",
      search: "PRIVATE",
      markets: ["PRIVATE"],
    } as MarketViewPreferences),
  ).toEqual({ state: "saved", view });
  expect(local.bytes()).toBe(raw);
  expect(readMarketViewPreferences(local)).toEqual({ state: "saved", view });
  expect(forgetMarketViewPreferences(local)).toEqual({ state: "missing" });
  expect(local.bytes()).toBeNull();
});
test.each([null, "", "{", "null", "[]", "0", '"string"', "x".repeat(1025)])(
  "unrecognized bytes stay missing or invalid: %j",
  (bytes) => {
    expect(parseMarketViewPreferences(bytes).state).toBe(
      bytes === null ? "missing" : "invalid",
    );
  },
);
test.each([2, 0, -1, "2", null, {}, []])(
  "unsupported schema %j is never overwritten or deleted",
  (version) => {
    const bytes = JSON.stringify({ version, ...view });
    const local = storage(bytes);
    expect(saveMarketViewPreferences(local, view).state).toBe("unsupported");
    expect(forgetMarketViewPreferences(local).state).toBe("unsupported");
    expect(local.calls).toEqual(["get", "get"]);
    expect(local.bytes()).toBe(bytes);
  },
);
test.each([
  { band: "arbitrary" },
  { platform: "ethereum" },
  { platform: ["all"] },
  { freshOnly: "true" },
  { sortKey: "wallet" },
  { sortDirection: "up" },
  { wallet: "PRIVATE" },
  { version: undefined },
])("strict allowlists reject without editing stored bytes: %j", (patch) => {
  const bytes = JSON.stringify({ version: 1, ...view, ...patch });
  const local = storage(bytes);
  expect(readMarketViewPreferences(local).state).toBe("invalid");
  expect(saveMarketViewPreferences(local, view).state).toBe("invalid");
  expect(forgetMarketViewPreferences(local).state).toBe("invalid");
  expect(local.bytes()).toBe(bytes);
  expect(local.calls).toEqual(["get", "get", "get"]);
});
describe("device storage failures", () => {
  test.each(["get", "set", "remove"])(
    "%s denial stays safe and does not apply any view",
    (failing) => {
      const local = {
        getItem() {
          if (failing === "get") throw Error("private raw details");
          return raw;
        },
        setItem() {
          if (failing === "set") throw Error("private raw details");
        },
        removeItem() {
          if (failing === "remove") throw Error("private raw details");
        },
      };
      const result =
        failing === "remove"
          ? forgetMarketViewPreferences(local)
          : saveMarketViewPreferences(local, view);
      expect(result).toEqual({ state: "unavailable" });
    },
  );
});
