import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("synthetic sandbox OpenAPI contract", () => {
  test("publishes only bounded read-only synthetic operations", async () => {
    const response = GET();
    const contract = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/vnd.oai.openapi+json",
    );
    expect(response.headers.get("x-symbaiex-environment")).toBe("sandbox");
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.servers).toEqual([
      expect.objectContaining({
        url: "https://www.symbaiex.com/api/sandbox",
        "x-environment": "sandbox",
        "x-synthetic-only": true,
      }),
    ]);
    expect(contract.security).toEqual([]);
    expect(Object.keys(contract.paths)).toEqual(["/v1/status", "/v1/search"]);
    expect(contract.paths["/v1/status"]).toHaveProperty("get");
    expect(contract.paths["/v1/search"]).toHaveProperty("get");
    expect(JSON.stringify(contract.paths)).not.toMatch(
      /post|put|patch|delete|bearer|token/i,
    );
    expect(contract.components.schemas.SandboxFixture.properties.id).toEqual(
      expect.objectContaining({ pattern: "^sandbox-" }),
    );
  });

  test("supports a body-free HEAD request", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
  });
});
