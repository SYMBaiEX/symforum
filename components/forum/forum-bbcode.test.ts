import { describe, expect, test } from "vitest";

import { parseForumBbcode } from "./forum-bbcode-model";

describe("forum BBCode parser", () => {
  test("parses a heading followed by a list without requiring a blank line", () => {
    const nodes = parseForumBbcode(
      "[b]Sources and further reading[/b]\n[list]\n[*]Primary source\n[*][b]Field notes[/b]\n[/list]",
    );

    expect(
      nodes.map((node) => (node.type === "tag" ? node.name : "text")),
    ).toEqual(["b", "text", "list"]);
    const list = nodes[2];
    expect(list?.type).toBe("tag");
    if (list?.type !== "tag") {
      throw new Error("Expected a parsed list");
    }
    expect(
      list.children
        .filter((node) => node.type === "tag")
        .map((node) => node.name),
    ).toEqual(["*", "*"]);
  });

  test("supports rich block and inline tags", () => {
    const nodes = parseForumBbcode(
      "[h2]Checklist[/h2][list=1][*]Map dependencies[/list][note]Context[/note][spoiler=Lab details]Hidden[/spoiler][table][tr][th]Mode[/th][td]Dry run[/td][/tr][/table]",
    );

    expect(
      nodes
        .filter((node) => node.type === "tag")
        .map((node) => [node.name, node.value]),
    ).toEqual([
      ["h2", undefined],
      ["list", "1"],
      ["note", undefined],
      ["spoiler", "Lab details"],
      ["table", undefined],
    ]);
  });

  test("preserves link values and unknown markup as text", () => {
    expect(
      parseForumBbcode(
        "[url=https://example.com/research]Primary research[/url]",
      )[0],
    ).toMatchObject({
      type: "tag",
      name: "url",
      value: "https://example.com/research",
    });
    expect(parseForumBbcode("[rainbow]signal[/rainbow]")).toEqual([
      { type: "text", value: "[rainbow]signal[/rainbow]" },
    ]);
  });
});
