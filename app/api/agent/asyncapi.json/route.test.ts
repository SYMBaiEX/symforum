import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

const eventTypes = [
  "evidence.document.changed",
  "evidence.research.completed",
  "evidence.export.completed",
  "evidence.benchmark.completed",
  "evidence.claim.verified",
];

const messageNames = [
  "DocumentChanged",
  "ResearchCompleted",
  "ExportCompleted",
  "BenchmarkCompleted",
  "ClaimVerified",
];

describe("agent AsyncAPI event contract", () => {
  test("publishes only the supported webhook receive operations", async () => {
    const response = GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.asyncapi).toBe("3.0.0");
    expect(document["x-symbaiex-verification-provisioning"]).toEqual({
      enabled: false,
      description: expect.stringContaining("self-service signature verification"),
    });
    expect(Object.keys(document.channels)).toEqual(eventTypes);
    expect(Object.values(document.operations)).toHaveLength(eventTypes.length);
    for (const eventType of eventTypes) {
      expect(document.channels[eventType].address).toBe(eventType);
    }
    for (const [index, eventType] of eventTypes.entries()) {
      const message = document.components.messages[messageNames[index]];
      expect(message.name).toBe(eventType);
      expect(message.headers.$ref).toBe("#/components/schemas/DeliveryHeaders");
    }
    expect(
      document.components.schemas.DeliveryHeaders.properties[
        "x-symbaiex-signature"
      ].description,
    ).toContain("provisioning is currently disabled");
    expect(Object.values(document.operations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "receive" }),
      ]),
    );
    expect(JSON.stringify(document)).not.toMatch(
      /storageId|resultJson|prompt|authorization|token/i,
    );
  });

  test("supports cacheable contract discovery with HEAD", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
