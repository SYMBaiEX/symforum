import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchHighlight, searchHighlightParts } from "./search-highlight";

const matches = (text: string, query: string) =>
  searchHighlightParts(text, query)
    .filter((part) => part.matched)
    .map((part) => part.text);
test.each([
  ["Solana and SOLANA", "solana", ["Solana", "SOLANA"]],
  ["Élan 東京 ΣΟΛ", "élan 東京 σολ", ["Élan", "東京", "ΣΟΛ"]],
  ["İx", "x", ["x"]],
  ["İx", "i", ["İ"]],
  ["ΟΣ", "ΟΣ", ["ΟΣ"]],
  ["ΟΣ", "ος", ["ΟΣ"]],
  ["ος", "ΟΣ", ["ος"]],
  ["οσ", "ος", ["οσ"]],
  ["ος", "οσ", ["ος"]],
  ["ΚΟΣΜΟΣ", "ΚΟΣΜΟΣ", ["ΚΟΣΜΟΣ"]],
  ["ΚΟΣΜΟΣ", "κοσμος", ["ΚΟΣΜΟΣ"]],
  ["κοσμος", "ΚΟΣΜΟΣ", ["κοσμος"]],
  ["E\u0301lan x", "e\u0301 x", ["E\u0301", "x"]],
  ["E\u0301lan", "élan", []],
  ["\u{10400}x", "\u{10428}", ["\u{10400}"]],
  ["Banana", "ana nana", ["anana"]],
  ["SOLANA", "sol solana SOL", ["SOLANA"]],
  ["a+b (test)", "a+b (test)", ["a+b", "(test)"]],
  ["test a.b", ".* [test]", []],
  ["😀 Solana 😀", "😀", ["😀", "😀"]],
])("literal Unicode/case and overlap: %s / %s", (text, query, expected) => {
  const parts = searchHighlightParts(text as string, query as string);
  expect(parts.map((part) => part.text).join("")).toBe(text);
  expect(matches(text as string, query as string)).toEqual(expected);
});
test.each(["", " ", "\n\t", "a".repeat(257), "x".repeat(65)])(
  "empty/oversized keywords stay plain and preserve all source text: %j",
  (query) => {
    const text =
      "a source excerpt with xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    expect(searchHighlightParts(text, query)).toEqual([
      { text, matched: false },
    ]);
  },
);
test("terms and marked segments are bounded without clipping original text", () => {
  const text = "a ".repeat(9000);
  const parts = searchHighlightParts(text, "a");
  expect(parts.map((part) => part.text).join("")).toBe(text);
  expect(parts.filter((part) => part.matched)).toHaveLength(64);
  expect(
    matches("ninth", "one two three four five six seven eight ninth"),
  ).toEqual([]);
});
test("scan boundary never splits a surrogate pair or invents a trailing match", () => {
  const text = `${"x".repeat(8191)}😀 done`;
  expect(searchHighlightParts(text, "😀")).toEqual([{ text, matched: false }]);
});
test("HTML and regex-looking payloads are text, never markup or rewritten links", () => {
  const text = '<script>alert("x")</script> [.*] https://example.test/?a=1&b=2';
  const html = renderToStaticMarkup(
    <SearchHighlight text={text} query="script [.*]" />,
  );
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<a");
  expect(html).toContain("&lt;");
  expect(html).toContain("&gt;");
  expect(html).toContain("[.*]</mark>");
  expect(html).toContain("https://example.test/?a=1&amp;b=2");
  expect(
    searchHighlightParts(text, "script [.*]")
      .map((part) => part.text)
      .join(""),
  ).toBe(text);
});
test("author-only and empty result text have no fabricated highlight", () => {
  expect(
    renderToStaticMarkup(<SearchHighlight text="Author result" query="" />),
  ).toBe("Author result");
  expect(renderToStaticMarkup(<SearchHighlight text="" query="solana" />)).toBe(
    "",
  );
});
