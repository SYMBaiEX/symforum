type TextPart = { text: string; matched: boolean };

// Apply the same context-independent fold on both sides. Final sigma is
// case-equivalent to sigma; its form must not depend on token/word boundaries.
const foldCodePoint = (character: string) =>
  character.toLowerCase().replaceAll("ς", "σ");

/** Literal, bounded highlighting only. It neither parses markup nor ranks results. */
export function searchHighlightParts(text: string, query: string): TextPart[] {
  const clean = query.trim();
  if (!clean || clean.length > 256) return [{ text, matched: false }];
  const terms = [
    ...new Set(
      clean
        .split(/\s+/u)
        .filter((term) => term.length <= 64)
        .map((term) => Array.from(term, foldCodePoint).join("")),
    ),
  ].slice(0, 8);
  if (!terms.length) return [{ text, matched: false }];
  // Keep original UTF-16 offsets even when a Unicode lowercase expands (İ).
  // The remaining text is rendered unchanged, without an unbounded scan.
  let limit = Math.min(text.length, 8192);
  if (limit < text.length && /[\uD800-\uDBFF]/u.test(text[limit - 1])) limit--;
  let folded = "",
    offset = 0;
  const starts: number[] = [],
    ends: number[] = [];
  for (const character of text.slice(0, limit)) {
    const lower = foldCodePoint(character);
    for (let index = 0; index < lower.length; index++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    folded += lower;
    offset += character.length;
  }
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (let count = 0; count < 64; count++) {
      const found = folded.indexOf(term, from);
      if (found < 0) break;
      ranges.push([starts[found], ends[found + term.length - 1]]);
      from = found + 1;
    }
  }
  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1])
      previous[1] = Math.max(previous[1], range[1]);
    else if (merged.length < 64) merged.push([...range]);
  }
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), matched: false });
    parts.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < text.length || !parts.length)
    parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}

export function SearchHighlight({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  return (
    <>
      {searchHighlightParts(text, query).map((part, index) =>
        part.matched ? (
          <mark
            key={index}
            className="rounded-sm bg-primary/15 text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
