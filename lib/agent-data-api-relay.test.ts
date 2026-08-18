import { describe, expect, test } from "vitest";
import {
  agentDataHeaders,
  isAllowedAgentOrigin,
  mapRestRequest,
} from "./agent-data-api-relay";

describe("agent data API relay", () => {
  test("maps only documented REST paths", () => {
    expect(
      mapRestRequest(
        "GET",
        ["search"],
        new URLSearchParams("q=convex&limit=10"),
      ),
    ).toEqual({ operation: "search", input: { query: "convex", limit: 10 } });
    expect(
      mapRestRequest("GET", ["internal"], new URLSearchParams()),
    ).toBeNull();
    expect(
      mapRestRequest(
        "GET",
        ["universal-search"],
        new URLSearchParams("q=convex&limit=10"),
      ),
    ).toEqual({
      operation: "universal_search",
      input: { query: "convex", limit: 10 },
    });
    expect(
      mapRestRequest("GET", ["entitlements"], new URLSearchParams()),
    ).toEqual({ operation: "entitlements", input: {} });
    expect(
      mapRestRequest("GET", ["usage"], new URLSearchParams("limit=5")),
    ).toEqual({ operation: "usage", input: { limit: 5 } });
    expect(
      mapRestRequest("GET", ["usage"], new URLSearchParams("limit=500")),
    ).toBeNull();
    expect(
      mapRestRequest("GET", ["search"], new URLSearchParams("q=x&extra=y")),
    ).toBeNull();
    expect(
      mapRestRequest(
        "GET",
        ["entities"],
        new URLSearchParams("q=github&limit=5"),
      ),
    ).toEqual({ operation: "entities", input: { query: "github", limit: 5 } });
    expect(
      mapRestRequest("POST", ["research-jobs"], new URLSearchParams(), {
        query: "Compare current evidence",
      }),
    ).toEqual({
      operation: "research_create",
      input: { query: "Compare current evidence" },
    });
    expect(
      mapRestRequest("POST", ["exports"], new URLSearchParams(), {
        datasetId: "dataset-id",
        format: "jsonl",
      }),
    ).toEqual({
      operation: "export_create",
      input: { datasetId: "dataset-id", format: "jsonl" },
    });
    expect(
      mapRestRequest("POST", ["exports"], new URLSearchParams(), {
        datasetId: "dataset-id",
        format: "parquet",
      }),
    ).toBeNull();
    expect(
      mapRestRequest("POST", ["webhooks"], new URLSearchParams(), {
        subscriptionKey: "research",
        url: "https://hooks.example.test/evidence",
        eventTypes: ["evidence.research.completed"],
      }),
    ).toEqual({
      operation: "webhooks_create",
      input: {
        subscriptionKey: "research",
        url: "https://hooks.example.test/evidence",
        eventTypes: ["evidence.research.completed"],
      },
    });
  });

  test("preserves strict origin and no-store headers", () => {
    const allowed = new Request(
      "https://www.symbaiex.com/api/agent/v1/status",
      { headers: { origin: "https://www.symbaiex.com" } },
    );
    expect(isAllowedAgentOrigin(allowed)).toBe(true);
    expect(agentDataHeaders(allowed).get("cache-control")).toContain(
      "no-store",
    );
    const denied = new Request("https://www.symbaiex.com/api/agent/v1/status", {
      headers: { origin: "https://evil.example" },
    });
    expect(isAllowedAgentOrigin(denied)).toBe(false);
  });
});
