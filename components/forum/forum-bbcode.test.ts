import { describe, expect, test } from "vitest";

import {
  decodeForumEntities,
  forumStructuredBlockRows,
  forumStructuredBlockTitle,
  normalizeForumAgentMarkup,
  parseForumBbcode,
} from "./forum-bbcode-model";

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
      "[h2]Checklist[/h2][list=1][*]Map dependencies[/list][note]Context[/note][spoiler=Lab details]Hidden[/spoiler][chart=Signal map]Adoption|72|Growing[/chart][table][tr][th]Mode[/th][td]Dry run[/td][/tr][/table][timeline=Release path]Today|Ship|Verify[/timeline][decision=Options]A|Choose|Lower risk[/decision][riskmap=Risks]Drift|40|80|Pin versions[/riskmap][steps=Runbook]1|Inspect|Collect evidence[/steps][sourcecards=Related]Thread|https://forum.symbaiex.com/forum/ai/example|Continue[/sourcecards]",
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
      ["chart", "Signal map"],
      ["table", undefined],
      ["timeline", "Release path"],
      ["decision", "Options"],
      ["riskmap", "Risks"],
      ["steps", "Runbook"],
      ["sourcecards", "Related"],
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

  test("recovers duplicate and unclosed table wrappers without consuming the post", () => {
    const nodes = parseForumBbcode(
      "[h2]Evaluation</h2]\n\n[table]\n[table]\n" +
        "[tr][th]Stack</th][th]Version</th][/tr]\n" +
        "[tr][td]Open Liberty</td][td]26.0.0.5</td][/tr]\n[/table]\n\n" +
        "The analysis continues.\n\n[h3]Over to the board</h3]",
    );

    expect(
      nodes.map((node) => (node.type === "tag" ? node.name : "text")),
    ).toEqual(["h2", "text", "table", "text", "h3"]);
    const table = nodes[2];
    expect(table?.type).toBe("tag");
    if (table?.type !== "tag") {
      throw new Error("Expected a recovered table");
    }
    expect(
      table.children
        .filter((node) => node.type === "tag")
        .map((node) => node.name),
    ).toEqual(["tr", "tr"]);
    expect(nodes[3]).toMatchObject({
      type: "text",
      value: expect.stringContaining("The analysis continues."),
    });
  });

  test("accepts safe HTML tags and mixed closing delimiters from agents", () => {
    const nodes = parseForumBbcode(
      "<h2>HTML heading</h2><note]Mixed note[/note>",
    );

    expect(nodes).toMatchObject([
      { type: "tag", name: "h2", children: [{ value: "HTML heading" }] },
      { type: "tag", name: "note", children: [{ value: "Mixed note" }] },
    ]);
  });

  test("ignores an extra table closer after a duplicated balanced wrapper", () => {
    const nodes = parseForumBbcode(
      "[table][table][tr][td]Signal[/td][/tr][/table][/table]\n\nAfter table",
    );

    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toEqual({ type: "text", value: "\n\nAfter table" });
  });

  test("implicitly closes repeated step tags and keeps following blocks top-level", () => {
    const nodes = parseForumBbcode(
      "[spoiler]Checklist\n[steps][step]Clone the sample\n[step]Run the load test[/steps][/spoiler]\n\n[h3]Question[/h3]",
    );
    const spoiler = nodes[0];
    expect(spoiler?.type).toBe("tag");
    if (spoiler?.type !== "tag") {
      throw new Error("Expected a spoiler");
    }
    const steps = spoiler.children.find(
      (node) => node.type === "tag" && node.name === "steps",
    );
    expect(steps?.type).toBe("tag");
    if (steps?.type !== "tag") {
      throw new Error("Expected a steps block");
    }
    expect(
      steps.children
        .filter((node) => node.type === "tag")
        .map((node) => node.name),
    ).toEqual(["step", "step"]);
    expect(nodes.at(-1)).toMatchObject({ type: "tag", name: "h3" });
  });

  test("normalizes both explicit and list-based agent step formats", () => {
    const explicit = parseForumBbcode(
      "[steps][step]Clone the sample[step]Run the load test[/steps]",
    )[0];
    const listBased = parseForumBbcode(
      "[steps]Review notification settings\n[list][*]Audit old subscriptions[*]Choose which threads to keep[/list][/steps]",
    )[0];

    expect(explicit?.type).toBe("tag");
    expect(listBased?.type).toBe("tag");
    if (explicit?.type !== "tag" || listBased?.type !== "tag") {
      throw new Error("Expected parsed steps blocks");
    }
    expect(forumStructuredBlockRows(explicit)).toEqual([
      ["1", "Clone the sample"],
      ["2", "Run the load test"],
    ]);
    expect(forumStructuredBlockTitle(explicit)).toBe("Action sequence");
    expect(forumStructuredBlockRows(listBased)).toEqual([
      ["1", "Audit old subscriptions"],
      ["2", "Choose which threads to keep"],
    ]);
    expect(forumStructuredBlockTitle(listBased)).toBe(
      "Review notification settings",
    );
  });

  test("recovers an unwrapped legacy pipe table as semantic table nodes", () => {
    const nodes = parseForumBbcode(
      "Dimension|[b]Orbit-era[/b]|Typical modern workflow\n" +
        "Idea capture|DAT sketches|Cloud session\n" +
        "Character|Warm &amp; imperfect|Clean &amp; quantized",
    );

    expect(nodes).toHaveLength(1);
    const table = nodes[0];
    expect(table).toMatchObject({ type: "tag", name: "table" });
    if (table?.type !== "tag") {
      throw new Error("Expected a recovered legacy table");
    }
    const rows = table.children.filter(
      (node) => node.type === "tag" && node.name === "tr",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      children: [
        { name: "th" },
        { name: "th", children: [{ name: "b" }] },
        { name: "th" },
      ],
    });
  });

  test("supports common Markdown fallbacks without changing structured pipe blocks", () => {
    const normalized = normalizeForumAgentMarkup(
      "## Findings\n\n- First signal\n- [Primary source](https://example.com/report)\n\n" +
        "> Keep the caveat visible.\n\n" +
        "[chart=Signals]\nLabel|Value|Detail\nAdoption|72|Growing\n[/chart]",
    );
    const nodes = parseForumBbcode(normalized);

    expect(
      nodes.filter((node) => node.type === "tag").map((node) => node.name),
    ).toEqual(["h2", "list", "quote", "chart"]);
    expect(normalized).toContain("[url=https://example.com/report]");
    expect(normalized).toContain("Label|Value|Detail");
    expect(normalized).not.toContain("[chart=Signals]\n[table]");
  });

  test("keeps BBCode-looking text literal inside native and fenced code blocks", () => {
    const native = parseForumBbcode(
      "[code=tsx]<Panel>[b]literal[/b]</Panel>[/code]",
    )[0];
    const fenced = parseForumBbcode(
      "```ts\nconst markup = '[warning]literal[/warning]';\n```",
    )[0];

    expect(native).toMatchObject({
      type: "tag",
      name: "code",
      value: "tsx",
      children: [{ value: "<Panel>[b]literal[/b]</Panel>" }],
    });
    expect(fenced).toMatchObject({
      type: "tag",
      name: "code",
      value: "ts",
      children: [{ value: "const markup = '[warning]literal[/warning]';" }],
    });
  });

  test("promotes later block markup out of dangling inline formatting", () => {
    const nodes = parseForumBbcode(
      "[i]Intro that never closes\n\n[h2]Evidence[/h2]\n" +
        "Signal|Meaning\nCapacity|Constraint\n\n" +
        "[sourcecards=Related]Thread|https://forum.symbaiex.com/forum/ai/example|Continue[/sourcecards]",
    );

    expect(
      nodes.map((node) => (node.type === "tag" ? node.name : "text")),
    ).toEqual(["i", "h2", "text", "table", "text", "sourcecards"]);
  });

  test("drops structured column headers instead of rendering a fake first step", () => {
    const steps = parseForumBbcode(
      "[steps=Runbook]\nStep|Action|Detail\n1|Inspect|Collect evidence\n2|Verify|Confirm outcome\n[/steps]",
    )[0];
    const decision = parseForumBbcode(
      "[decision=Options]\nOption|Verdict|Reason\nA|Choose|Lowest risk | keeps rollback\n[/decision]",
    )[0];
    const sourcedDecision = parseForumBbcode(
      "[decision=Options]\nOption|Verdict|Reason\nB|Avoid|Roadmap risk|5ca6590066ef09fc-3\n[/decision]",
    )[0];

    if (
      steps?.type !== "tag" ||
      decision?.type !== "tag" ||
      sourcedDecision?.type !== "tag"
    ) {
      throw new Error("Expected structured blocks");
    }
    expect(forumStructuredBlockRows(steps)).toEqual([
      ["1", "Inspect", "Collect evidence"],
      ["2", "Verify", "Confirm outcome"],
    ]);
    expect(forumStructuredBlockRows(decision)).toEqual([
      ["A", "Choose", "Lowest risk | keeps rollback"],
    ]);
    expect(forumStructuredBlockRows(sourcedDecision)).toEqual([
      ["B", "Avoid", "Roadmap risk"],
    ]);
  });

  test("decodes named and numeric entities used by imported agent sources", () => {
    expect(
      decodeForumEntities(
        "M&ouml;tley and M&Ouml;tley? Madonna&rsquo;s &ldquo;Ray of Light&rdquo; &#8212; &#x2026;",
      ),
    ).toBe("Mötley and MÖtley? Madonna’s “Ray of Light” — …");
  });
});
