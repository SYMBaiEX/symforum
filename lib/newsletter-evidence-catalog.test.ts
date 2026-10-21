import { describe, expect, test } from "vitest";
import {
  buildEditorialEvidenceCatalog,
  type EditorialEvidenceSource,
} from "./newsletter-evidence-catalog";

describe("editorial evidence catalog", () => {
  test("reconstructs every character across Unicode, whitespace, and long words", () => {
    const sources = [
      { hnItemId: 17, sourceText: `\t  αβγ\n${"word ".repeat(80)}\r\nEnd` },
      { hnItemId: 28, sourceText: `${"x".repeat(169)}😀${"y".repeat(400)}` },
      { hnItemId: 39, sourceText: "w".repeat(20_000) },
    ];
    const catalog = buildEditorialEvidenceCatalog(sources);

    expect(catalog.sources).toHaveLength(sources.length);
    for (const [index, source] of catalog.sources.entries()) {
      expect(source.hnItemId).toBe(sources[index].hnItemId);
      expect(source.segments.map((segment) => segment.text).join("")).toBe(
        sources[index].sourceText,
      );
      for (const [segmentIndex, segment] of source.segments.entries()) {
        expect(segment.id).toBe(`${source.hnItemId}:q${segmentIndex}`);
        expect(segment.text.length).toBeLessThanOrEqual(180);
        const last = segment.text.charCodeAt(segment.text.length - 1);
        const next = source.segments[segmentIndex + 1]?.text.charCodeAt(0);
        expect(
          last >= 0xd800 &&
            last <= 0xdbff &&
            next! >= 0xdc00 &&
            next! <= 0xdfff,
        ).toBe(false);
      }
    }
    expect(catalog.sources[1].segments[1].text.startsWith("😀")).toBe(true);
  });

  test("keeps stable unique IDs and maps eligible quotes verbatim", () => {
    const sources = [
      {
        hnItemId: 7,
        sourceText: "Evidence sentence one. Evidence sentence two.",
      },
      { hnItemId: 8, sourceText: "A second source with independent evidence." },
    ];
    const first = buildEditorialEvidenceCatalog(sources);
    const second = buildEditorialEvidenceCatalog(sources);
    const ids = first.sources.flatMap((source) =>
      source.segments.map((segment) => segment.id),
    );
    expect(ids).toEqual(
      second.sources.flatMap((source) =>
        source.segments.map((segment) => segment.id),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of first.sources) {
      for (const segment of source.segments) {
        expect(first.byId.get(segment.id)).toEqual({
          sourceId: source.hnItemId,
          quote: segment.text,
        });
      }
    }
  });

  test("merges a short final tail without exceeding the quote ceiling", () => {
    const sourceText = `${"x".repeat(170)}short`;
    const catalog = buildEditorialEvidenceCatalog([
      { hnItemId: 91, sourceText },
    ]);
    expect(catalog.sources[0].segments).toEqual([
      { id: "91:q0", text: sourceText },
    ]);
    expect(catalog.byId.get("91:q0")?.quote.length).toBe(175);
  });

  test("retains tiny, empty, and whitespace-only context without citing it", () => {
    const catalog = buildEditorialEvidenceCatalog([
      { hnItemId: 1, sourceText: "tiny" },
      { hnItemId: 2, sourceText: "" },
      { hnItemId: 3, sourceText: " \n\t".repeat(60) },
      { hnItemId: 4, sourceText: "x".repeat(10) },
    ]);
    expect(
      catalog.sources.map((source) =>
        source.segments.map((part) => part.text).join(""),
      ),
    ).toEqual(["tiny", "", " \n\t".repeat(60), "x".repeat(10)]);
    expect(catalog.sources[1].segments).toEqual([]);
    expect([...catalog.byId.keys()]).toEqual(["4:q0"]);
  });

  test("rejects duplicate or invalid source IDs and invalid text", () => {
    const valid = { hnItemId: 12, sourceText: "valid source" };
    for (const invalid of [
      { hnItemId: 12, sourceText: "duplicate" },
      { hnItemId: 0, sourceText: "zero" },
      { hnItemId: -1, sourceText: "negative" },
      { hnItemId: 1.5, sourceText: "fraction" },
      { hnItemId: Number.NaN, sourceText: "NaN" },
      { hnItemId: Number.POSITIVE_INFINITY, sourceText: "infinity" },
      { hnItemId: Number.MAX_SAFE_INTEGER + 1, sourceText: "unsafe" },
      { hnItemId: 13, sourceText: 42 },
    ]) {
      expect(() =>
        buildEditorialEvidenceCatalog([
          valid,
          invalid as EditorialEvidenceSource,
        ]),
      ).toThrow(TypeError);
    }
  });
});
