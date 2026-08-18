import { describe, expect, test } from "vitest";

import { isAgentEventEnvelope } from "./agent-event-contract";

const occurredAt = 1_755_530_400;

describe("agent event envelope contract", () => {
  test.each([
    {
      id: "document:doc_1:version:2",
      type: "evidence.document.changed",
      occurredAt,
      data: {
        documentId: "doc_1",
        documentVersionId: "version_2",
        version: 2,
        kind: "release",
        canonicalUrl: "https://example.com/releases/2",
      },
    },
    {
      id: "research:job_1:completed",
      type: "evidence.research.completed",
      occurredAt,
      data: {
        researchJobId: "job_1",
        status: "completed",
        expiresAt: occurredAt,
      },
    },
    {
      id: "export:job_2:completed",
      type: "evidence.export.completed",
      occurredAt,
      data: {
        exportJobId: "job_2",
        status: "completed",
        checksum: "abc123",
        recordCount: 2,
        expiresAt: occurredAt,
      },
    },
    {
      id: "benchmark:2026-08-18:completed",
      type: "evidence.benchmark.completed",
      occurredAt,
      data: {
        runId: "run_1",
        runKey: "evidence-citation-coverage:2026-08-18",
        score: 0.8,
        model: "deterministic-rules-v1",
      },
    },
    {
      id: "claim:claim_1:version:2",
      type: "evidence.claim.verified",
      occurredAt,
      data: {
        claimId: "claim_1",
        documentVersionId: "version_2",
        status: "supported",
        confidence: 1,
      },
    },
  ])("accepts current emitter shape for $type", (event) => {
    expect(isAgentEventEnvelope(event)).toBe(true);
  });

  test("rejects unsupported event types and sensitive payload fields", () => {
    expect(
      isAgentEventEnvelope({
        id: "research:job_1:completed",
        type: "evidence.research.completed",
        occurredAt,
        data: {
          researchJobId: "job_1",
          status: "completed",
          expiresAt: occurredAt,
          resultStorageId: "storage_1",
        },
      }),
    ).toBe(false);
    expect(
      isAgentEventEnvelope({
        id: "other:1",
        type: "evidence.usage.updated",
        occurredAt,
        data: {},
      }),
    ).toBe(false);
  });

  test("accepts NVD and ingestion changedFields while retaining first-party compatibility", () => {
    const base = {
      id: "document:doc_1:version:2",
      type: "evidence.document.changed" as const,
      occurredAt,
      data: {
        documentId: "doc_1",
        documentVersionId: "version_2",
        version: 2,
        canonicalUrl: "https://example.com/releases/2",
      },
    };
    expect(isAgentEventEnvelope(base)).toBe(true);
    expect(
      isAgentEventEnvelope({
        ...base,
        data: { ...base.data, changedFields: ["title", "excerpt", "sourceUpdatedAt"] },
      }),
    ).toBe(true);
  });

  test("rejects invalid, oversized, and extra document-change fields", () => {
    const base = {
      id: "document:doc_1:version:2",
      type: "evidence.document.changed" as const,
      occurredAt,
      data: {
        documentId: "doc_1",
        documentVersionId: "version_2",
        version: 2,
        canonicalUrl: "https://example.com/releases/2",
      },
    };
    expect(isAgentEventEnvelope({ ...base, data: { ...base.data, changedFields: ["title", 1] } })).toBe(false);
    expect(isAgentEventEnvelope({ ...base, data: { ...base.data, changedFields: ["x".repeat(129)] } })).toBe(false);
    expect(isAgentEventEnvelope({ ...base, data: { ...base.data, changedFields: Array.from({ length: 33 }, () => "title") } })).toBe(false);
    expect(isAgentEventEnvelope({ ...base, data: { ...base.data, changedFields: ["title"], extra: true } })).toBe(false);
  });
});
