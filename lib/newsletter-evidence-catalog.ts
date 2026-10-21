export type EditorialEvidenceSource = {
  hnItemId: number;
  sourceText: string;
};

export type EditorialEvidenceCatalog = {
  sources: Array<{
    hnItemId: number;
    segments: Array<{ id: string; text: string }>;
  }>;
  byId: Map<string, { sourceId: number; quote: string }>;
};

const TARGET_SEGMENT_LENGTH = 170;
const MAX_QUOTE_LENGTH = 180;
const MIN_QUOTE_LENGTH = 10;

function segmentEnd(text: string, start: number): number {
  let end = Math.min(start + TARGET_SEGMENT_LENGTH, text.length);
  if (
    end < text.length &&
    end > start &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  ) {
    end -= 1;
  }
  if (end === text.length) return end;
  for (let index = end - 1; index >= start + MIN_QUOTE_LENGTH - 1; index--) {
    if (/\s/u.test(text[index])) return index + 1;
  }
  return end;
}

export function buildEditorialEvidenceCatalog(
  sources: Array<EditorialEvidenceSource>,
): EditorialEvidenceCatalog {
  if (!Array.isArray(sources)) throw new TypeError("Invalid evidence sources");

  const seen = new Set<number>();
  const catalog: EditorialEvidenceCatalog = { sources: [], byId: new Map() };
  for (const source of sources) {
    if (
      !Number.isSafeInteger(source?.hnItemId) ||
      source.hnItemId <= 0 ||
      typeof source.sourceText !== "string" ||
      seen.has(source.hnItemId)
    ) {
      throw new TypeError("Invalid or duplicate evidence source");
    }
    seen.add(source.hnItemId);

    const parts: string[] = [];
    for (let start = 0; start < source.sourceText.length;) {
      const end = segmentEnd(source.sourceText, start);
      parts.push(source.sourceText.slice(start, end));
      start = end;
    }
    if (parts.length > 1 && parts.at(-1)!.length < MIN_QUOTE_LENGTH) {
      const tail = parts.pop()!;
      const previous = parts.length - 1;
      if (parts[previous].length + tail.length <= MAX_QUOTE_LENGTH) {
        parts[previous] += tail;
      } else {
        parts.push(tail);
      }
    }

    const segments = parts.map((text, index) => ({
      id: `${source.hnItemId}:q${index}`,
      text,
    }));
    catalog.sources.push({ hnItemId: source.hnItemId, segments });
    for (const segment of segments) {
      if (
        segment.text.length >= MIN_QUOTE_LENGTH &&
        segment.text.length <= MAX_QUOTE_LENGTH &&
        segment.text.trim().length > 0
      ) {
        catalog.byId.set(segment.id, {
          sourceId: source.hnItemId,
          quote: segment.text,
        });
      }
    }
  }
  return catalog;
}
