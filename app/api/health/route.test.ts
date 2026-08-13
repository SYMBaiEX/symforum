import { describe, expect, test } from "vitest";
import { GET } from "./route";

describe("health endpoint", () => {
  test("returns a no-store runtime health payload", async () => {
    const response = GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(payload).toMatchObject({
      status: "ok",
      service: "symbaiex-web",
    });
    expect(payload.timestamp).toEqual(expect.any(String));
  });
});
