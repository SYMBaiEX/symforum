import { parquetWriteBuffer } from "hyparquet-writer";

export type EvidenceArtifactFormat = "jsonl" | "parquet";

type ExportableRecord = Record<string, unknown> & {
  schemaVersion: string;
  datasetKey: string;
  documentId: string;
  versionId: string | null;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  kind: string;
  licenseClass: string;
  publishedAt: number | null;
  firstSeenAt: number;
  updatedAt: number;
  source: { sourceKey: string };
};

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

/** Serializes the same stable row contract to JSONL or interoperable Parquet. */
export function serializeEvidenceExport(
  format: EvidenceArtifactFormat,
  records: ExportableRecord[],
) {
  if (format === "jsonl") {
    const body =
      records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length ? "\n" : "");
    return {
      bytes: new TextEncoder().encode(body),
      contentType: "application/x-ndjson",
      extension: "jsonl",
    } as const;
  }

  const columnData = [
    { name: "schema_version", data: records.map((r) => r.schemaVersion), type: "STRING" as const },
    { name: "dataset_key", data: records.map((r) => r.datasetKey), type: "STRING" as const },
    { name: "document_id", data: records.map((r) => String(r.documentId)), type: "STRING" as const },
    { name: "version_id", data: records.map((r) => r.versionId ?? ""), type: "STRING" as const },
    { name: "source_key", data: records.map((r) => r.source.sourceKey), type: "STRING" as const },
    { name: "title", data: records.map((r) => r.title), type: "STRING" as const },
    { name: "excerpt", data: records.map((r) => r.excerpt), type: "STRING" as const },
    { name: "canonical_url", data: records.map((r) => r.canonicalUrl), type: "STRING" as const },
    { name: "kind", data: records.map((r) => r.kind), type: "STRING" as const },
    { name: "license_class", data: records.map((r) => r.licenseClass), type: "STRING" as const },
    { name: "published_at", data: records.map((r) => r.publishedAt ?? 0), type: "DOUBLE" as const },
    { name: "first_seen_at", data: records.map((r) => r.firstSeenAt), type: "DOUBLE" as const },
    { name: "updated_at", data: records.map((r) => r.updatedAt), type: "DOUBLE" as const },
    { name: "record_json", data: records.map(json), type: "JSON" as const },
  ];
  const bytes = new Uint8Array(parquetWriteBuffer({ columnData }));
  return {
    bytes,
    contentType: "application/vnd.apache.parquet",
    extension: "parquet",
  } as const;
}
