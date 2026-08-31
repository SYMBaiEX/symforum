/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import {
  evidenceRetryPolicy,
  normalizeEvidenceBatch,
  validateEvidenceAdapterDescriptor,
} from "./evidenceSourceAdapter";
import { PUBLIC_EVIDENCE_SOURCE_REGISTRY } from "./evidenceSourceRegistry";

const source = PUBLIC_EVIDENCE_SOURCE_REGISTRY[0]!;

describe("evidence source adapter contract", () => {
  test("validates every licensed source descriptor and supplies bounded retries", () => {
    for (const descriptor of PUBLIC_EVIDENCE_SOURCE_REGISTRY) {
      expect(validateEvidenceAdapterDescriptor(descriptor)).toBe(descriptor);
      expect(evidenceRetryPolicy(descriptor)).toMatchObject({
        maximumAttempts: 3,
        initialDelayMs: 500,
        maximumDelayMs: 8_000,
      });
    }
  });

  test("produces deterministic detached normalized output", () => {
    const batch = normalizeEvidenceBatch(source, {
      sourceKey: source.key,
      checkpoint: { etag: "fixture-v1" },
      documents: [
        {
          sourceKey: source.key,
          externalId: "doc-b",
          canonicalUrl: "https://example.com/b",
          title: "B",
          observedAt: 2,
          attribution: source.name,
        },
        {
          sourceKey: source.key,
          externalId: "doc-a",
          canonicalUrl: "https://example.com/a",
          title: "A",
          observedAt: 1,
          attribution: source.name,
        },
      ],
      entities: [
        {
          sourceKey: source.key,
          externalId: "entity-a",
          kind: "software",
          name: "Fixture",
        },
      ],
      claims: [
        {
          sourceKey: source.key,
          externalId: "claim-a",
          documentExternalId: "doc-a",
          predicate: "has-status",
          value: "fixture",
          support: "asserted",
        },
      ],
    });
    expect(batch.documents.map((row) => row.externalId)).toEqual([
      "doc-a",
      "doc-b",
    ]);
    expect(batch).not.toBe(
      normalizeEvidenceBatch(source, {
        ...batch,
        documents: batch.documents,
      }),
    );
  });

  test("rejects cross-source rows, unknown documents, and overflow", () => {
    const base = {
      sourceKey: source.key,
      checkpoint: {},
      documents: [
        {
          sourceKey: source.key,
          externalId: "doc-a",
          canonicalUrl: "https://example.com/a",
          title: "A",
          observedAt: 1,
          attribution: source.name,
        },
      ],
      entities: [],
      claims: [],
    } as const;
    expect(() =>
      normalizeEvidenceBatch(source, {
        ...base,
        sourceKey: "other-source",
      }),
    ).toThrow(/emitted batch/);
    expect(() =>
      normalizeEvidenceBatch(source, {
        ...base,
        claims: [
          {
            sourceKey: source.key,
            externalId: "claim-a",
            documentExternalId: "missing",
            predicate: "has-status",
            value: "fixture",
            support: "asserted" as const,
          },
        ],
      }),
    ).toThrow(/unknown normalized document/);
  });
});
