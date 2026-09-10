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
    expect(
      document.components.schemas.ExportRequest.properties.recordLimit,
    ).toMatchObject({
      minimum: 1,
      maximum: 500,
      default: 100,
    });
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
    expect(document.paths["/v1/batch"].post).toMatchObject({
      operationId: "batchEvidenceReads",
      security: [{ bearerAuth: [] }],
    });
    expect(
      document.components.schemas.BatchRequest.properties.operations,
    ).toMatchObject({
      minItems: 1,
      maxItems: 10,
    });
    expect(
      document.paths["/v1/research-jobs"].post.responses["202"].headers
        .Location,
    ).toBeDefined();
    expect(
      document.paths["/v1/exports"].post.responses["202"].headers.Location,
    ).toBeDefined();
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
        configuredSourceCount: expect.any(Object),
        sourceCoverageScore: expect.any(Object),
        missingSourceKeys: expect.any(Object),
        citationCoverageScore: expect.any(Object),
        entityCount: expect.any(Object),
        entityCoverageScore: expect.any(Object),
        claimCount: expect.any(Object),
        claimCoverageScore: expect.any(Object),
      }),
    );
  });

  test("gives every operation a unique id, summary, and description", async () => {
    const document = await GET().json();
    const methods = new Set([
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
    ]);
    const operations = Object.entries(document.paths).flatMap(
      ([path, pathItem]) =>
        Object.entries(pathItem as Record<string, unknown>)
          .filter(([method]) => methods.has(method))
          .map(([method, operation]) => ({
            path,
            method,
            operation: operation as Record<string, unknown>,
          })),
    );
    const ids = operations.map(({ operation }) => operation.operationId);

    expect(operations).toHaveLength(44);
    expect(new Set(ids).size).toBe(operations.length);
    for (const { operation } of operations) {
      expect(operation.operationId).toEqual(expect.any(String));
      expect(operation.summary).toEqual(expect.any(String));
      expect(String(operation.summary).length).toBeGreaterThan(8);
      expect(operation.description).toEqual(expect.any(String));
      expect(String(operation.description).length).toBeGreaterThan(30);
    }
  });

  test("publishes structured errors and verifiable artifact schemas", async () => {
    const document = await GET().json();
    expect(
      document.components.schemas.AgentError.properties.retryAfter,
    ).toMatchObject({ type: "integer", minimum: 0 });
    expect(
      document.components.schemas.ArtifactMetadata.properties.sha256.pattern,
    ).toContain("64");
    expect(document.components.schemas.ExportManifest.required).toEqual(
      expect.arrayContaining(["checksum", "recordCount"]),
    );
    expect(
      document.paths["/v1/exports"].post.responses["429"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/AgentError");
  });

  test("types every success response and documents API lifecycle headers", async () => {
    const document = await GET().json();
    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(
        pathItem as Record<string, Record<string, unknown>>,
      )) {
        if (
          !new Set([
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
          ]).has(method)
        )
          continue;
        const responses = operation.responses as Record<
          string,
          {
            content?: Record<string, { schema?: unknown }>;
            headers?: Record<string, unknown>;
          }
        >;
        for (const [status, response] of Object.entries(responses)) {
          if (!/^2/.test(status)) continue;
          expect(
            response.content,
            `${method.toUpperCase()} ${path} ${status}`,
          ).toBeDefined();
          expect(
            Object.values(response.content ?? {}).some((entry) => entry.schema),
            `${method.toUpperCase()} ${path} ${status}`,
          ).toBe(true);
          if (path.startsWith("/v1/")) {
            expect(response.headers?.["RateLimit-Policy"]).toBeDefined();
            expect(response.headers?.Link).toBeDefined();
          }
        }
      }
    }
    expect(document.info["x-api-lifecycle"]).toBe(
      "https://www.symbaiex.com/developers/api-lifecycle",
    );
  });
});
