import { parquetReadObjects } from "hyparquet";
import { describe, expect, test } from "vitest";
import { serializeEvidenceExport } from "./evidence-export-format";

const record = {
  schemaVersion: "v3",
  datasetKey: "security",
  documentId: "document-1",
  versionId: "version-1",
  title: "Advisory",
  excerpt: "Evidence",
  canonicalUrl: "https://example.com/advisory",
  kind: "advisory",
  licenseClass: "public-domain",
  publishedAt: 100,
  firstSeenAt: 101,
  updatedAt: 102,
  source: { sourceKey: "cisa-kev" },
};

describe("serializeEvidenceExport", () => {
  test("keeps JSONL newline-delimited", () => {
    const result = serializeEvidenceExport("jsonl", [record]);
    expect(new TextDecoder().decode(result.bytes)).toBe(`${JSON.stringify(record)}\n`);
    expect(result.contentType).toBe("application/x-ndjson");
  });

  test("writes readable Parquet with a canonical JSON row", async () => {
    const result = serializeEvidenceExport("parquet", [record]);
    const file = {
      byteLength: result.bytes.byteLength,
      slice: (start: number, end?: number) =>
        result.bytes.buffer.slice(start, end ?? result.bytes.byteLength),
    };
    const rows = await parquetReadObjects({
      file,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dataset_key: "security",
      source_key: "cisa-kev",
      document_id: "document-1",
    });
    expect(JSON.parse(String(rows[0].record_json))).toMatchObject(record);
  });
});
