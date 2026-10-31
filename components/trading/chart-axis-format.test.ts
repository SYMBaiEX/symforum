import { describe, expect, it } from "vitest";
import { formatChartAxisPrice } from "./chart-axis-format";

describe("display-only chart tick formatting", () => {
  it("removes autoscale roundoff rather than filling the phone with negative zero", () => {
    expect(formatChartAxisPrice(-3.7947e-20, 1e-7)).toBe("$0");
    expect(formatChartAxisPrice(-0, 1e-7)).toBe("$0");
    expect(formatChartAxisPrice(0, 1e-7)).toBe("$0");
  });

  it("preserves real small prices and meaningful negative axis ticks", () => {
    expect(formatChartAxisPrice(0.000000005835, 1e-13)).toBe("$0.000000005835");
    expect(formatChartAxisPrice(-0.0005, 1e-7)).toBe("-$0.0005");
    expect(formatChartAxisPrice(142.123, 0.01)).toBe("$142.12");
  });

  it("keeps invalid ticks unavailable and never infers precision from an invalid step", () => {
    expect(formatChartAxisPrice(NaN, 1e-7)).toBe("--");
    expect(formatChartAxisPrice(Infinity, 1e-7)).toBe("--");
    expect(formatChartAxisPrice(0.0005, NaN)).toBe("$0.0005");
  });
});
