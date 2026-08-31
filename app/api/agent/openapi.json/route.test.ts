import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("agent API OpenAPI contract", () => {
  test("describes the stable authentication endpoints", async () => {
    const response = GET();
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.description).toContain("not provisioned");
    expect(document.servers).toEqual([
      { url: "https://www.symbaiex.com/api/agent" },
    ]);
    expect(document.paths["/auth/challenge"].post.operationId).toBe(
      "requestAgentLoginChallenge",
    );
    expect(document.paths["/auth/sign-in"].post.operationId).toBe(
      "signInAgent",
    );
    expect(document.paths["/auth/refresh"].post.operationId).toBe(
      "refreshAgentSession",
    );
    expect(document.components.schemas.SignInRequest.required).toEqual(
      expect.arrayContaining(["agentId", "challenge", "signature"]),
    );
    expect(document.paths["/v1/search"].get.operationId).toBe("searchEvidence");
    expect(document.paths["/v1/source-registry"].get).toMatchObject({
      operationId: "getPublicEvidenceSourceRegistry",
      security: [{ bearerAuth: [] }],
    });
    expect(document.paths["/v1/source-registry"].get.description).toMatch(
      /omits credentials.*cursors/i,
    );
    expect(document.paths["/v1/claims/{claimKey}/timeline"].get).toMatchObject({
      operationId: "listEvidenceClaimTimeline",
      security: [{ bearerAuth: [] }],
    });
    expect(
      document.paths["/v1/claims/{claimKey}/timeline"].get.description,
    ).toMatch(/no additional timeline status/i);
    expect(document.paths["/v1/universal-search"].get.operationId).toBe(
      "searchUniversalPublicCorpus",
    );
    expect(document.paths["/v1/universal-search"].get.description).toMatch(
      /endpoint remains lexical-only/i,
    );
    expect(document.paths["/v1/semantic-search"].get.operationId).toBe(
      "searchSemanticPublicCorpus",
    );
    expect(document.paths["/v1/semantic-search"].get.description).toMatch(
      /lexical-only[\s\S]*service account[\s\S]*budget/i,
    );
    expect(document.components.parameters.SemanticIdempotencyKey).toMatchObject(
      { required: true, schema: { minLength: 8, maxLength: 96 } },
    );
    expect(document.paths["/v1/research-jobs"].post.operationId).toBe(
      "createEvidenceResearchJob",
    );
    expect(document.paths["/v1/exports"].post.operationId).toBe(
      "createEvidenceExport",
    );
    expect(document.paths["/v1/exports/{jobId}/manifest"].get.operationId).toBe(
      "getEvidenceExportManifest",
    );
    expect(document.paths["/v1/webhooks"].post.operationId).toBe(
      "createEvidenceWebhook",
    );
    expect(document.paths["/v1/webhooks/availability"].get.operationId).toBe(
      "getEvidenceWebhookAvailability",
    );
    expect(
      document.paths[
        "/v1/webhooks/{subscriptionKey}/deliveries/{eventKey}/replay"
      ].post.operationId,
    ).toBe("replayEvidenceWebhookDelivery");
    expect(document.components.parameters.SubscriptionKey.required).toBe(true);
    expect(document.paths["/v1/entitlements"].get.operationId).toBe(
      "getEvidenceEntitlements",
    );
    expect(document.paths["/v1/usage"].get.operationId).toBe(
      "getEvidenceUsage",
    );
    expect(document.components.parameters.IdempotencyKey.required).toBe(true);
    expect(document.paths["/mcp"].post.operationId).toBe("evidenceMcp");
  });

  test("describes measurable versioned dataset coverage", async () => {
    const response = GET();
    const document = await response.json();
    const operation = document.paths["/v1/datasets"].get;
    const schema =
      operation.responses["200"].content["application/json"].schema;

    expect(operation.operationId).toBe("listEvidenceDatasets");
    expect(schema.items.$ref).toBe("#/components/schemas/EvidenceDataset");
    expect(
      document.components.schemas.EvidenceDataset.properties.latestVersion
        .anyOf[1].properties,
    ).toEqual(
      expect.objectContaining({
        checksum: expect.any(Object),
        completenessScore: expect.any(Object),
        freshnessScore: expect.any(Object),
        citationCount: expect.any(Object),
      }),
    );
  });
});
