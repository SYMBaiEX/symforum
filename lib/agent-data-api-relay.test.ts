import { describe, expect, test } from "vitest";
import {
  agentDataHeaders,
  isAllowedAgentOrigin,
  mapRestRequest,
} from "./agent-data-api-relay";

describe("agent data API relay", () => {
  test("maps only documented REST paths", () => {
    expect(
      mapRestRequest("GET", ["source-registry"], new URLSearchParams()),
    ).toEqual({ operation: "source_registry", input: {} });
    expect(
      mapRestRequest(
        "GET",
        ["source-registry"],
        new URLSearchParams("limit=1"),
      ),
    ).toBeNull();
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
      mapRestRequest(
        "GET",
        ["semantic-search"],
        new URLSearchParams("q=convex&limit=10"),
      ),
    ).toEqual({
      operation: "semantic_search",
      input: { query: "convex", limit: 10 },
    });
    expect(
      mapRestRequest(
        "GET",
        ["semantic-search"],
        new URLSearchParams("q=convex&limit=21"),
      ),
    ).toBeNull();
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
      input: { datasetId: "dataset-id", format: "jsonl", recordLimit: 100 },
    });
    expect(
      mapRestRequest("POST", ["exports"], new URLSearchParams(), {
        datasetId: "dataset-id",
        recordLimit: 500,
      }),
    ).toEqual({
      operation: "export_create",
      input: { datasetId: "dataset-id", format: "jsonl", recordLimit: 500 },
    });
    expect(
      mapRestRequest("POST", ["exports"], new URLSearchParams(), {
        datasetId: "dataset-id",
        recordLimit: 501,
      }),
    ).toBeNull();
    expect(
      mapRestRequest(
        "GET",
        ["datasets", "dataset-id", "versions"],
        new URLSearchParams("limit=2&cursor=2026-01-02"),
      ),
    ).toEqual({
      operation: "dataset_versions",
      input: {
        datasetId: "dataset-id",
        limit: 2,
        cursor: "2026-01-02",
      },
    });
    expect(
      mapRestRequest(
        "GET",
        ["datasets", "dataset-id", "versions", "version-id", "artifact"],
        new URLSearchParams(),
      ),
    ).toEqual({
      operation: "dataset_version_artifact",
      input: { datasetId: "dataset-id", versionId: "version-id" },
    });
    expect(
      mapRestRequest(
        "GET",
        ["datasets", "dataset-id", "versions", "version-id", "diff"],
        new URLSearchParams("against=previous-id"),
      ),
    ).toEqual({
      operation: "dataset_version_diff",
      input: {
        datasetId: "dataset-id",
        versionId: "version-id",
        againstVersionId: "previous-id",
      },
    });
    expect(
      mapRestRequest("POST", ["exports"], new URLSearchParams(), {
        datasetId: "dataset-id",
        format: "parquet",
      }),
    ).toEqual({
      operation: "export_create",
      input: { datasetId: "dataset-id", format: "parquet", recordLimit: 100 },
    });
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
    expect(
      mapRestRequest(
        "GET",
        ["claims", "release-security", "timeline"],
        new URLSearchParams("limit=50"),
      ),
    ).toEqual({
      operation: "claim_timeline",
      input: { claimKey: "release-security", limit: 50 },
    });
    expect(
      mapRestRequest(
        "GET",
        ["claims", "release-security", "timeline"],
        new URLSearchParams("limit=51"),
      ),
    ).toBeNull();
    expect(
      mapRestRequest(
        "GET",
        ["webhooks", "research", "deliveries"],
        new URLSearchParams("limit=5"),
      ),
    ).toEqual({
      operation: "webhooks_history",
      input: { subscriptionKey: "research", limit: 5 },
    });
    expect(
      mapRestRequest(
        "POST",
        ["webhooks", "research", "deliveries", "event-1", "replay"],
        new URLSearchParams(),
        {},
      ),
    ).toEqual({
      operation: "webhooks_replay",
      input: { subscriptionKey: "research", eventKey: "event-1" },
    });
    expect(
      mapRestRequest(
        "POST",
        ["webhooks", "research", "test"],
        new URLSearchParams(),
        { eventType: "evidence.research.completed" },
      ),
    ).toEqual({
      operation: "webhooks_test",
      input: {
        subscriptionKey: "research",
        eventType: "evidence.research.completed",
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
    expect(
      agentDataHeaders(allowed).get("access-control-expose-headers"),
    ).toContain("x-artifact-sha256");
    expect(
      agentDataHeaders(allowed).get("access-control-expose-headers"),
    ).toContain("content-length");
    expect(
      agentDataHeaders(allowed).get("access-control-expose-headers"),
    ).toContain("content-disposition");
    const denied = new Request("https://www.symbaiex.com/api/agent/v1/status", {
      headers: { origin: "https://evil.example" },
    });
    expect(isAllowedAgentOrigin(denied)).toBe(false);
  });
});
