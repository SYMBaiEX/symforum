import { expect, test } from "vitest";
import { publicationCashtags } from "./token-cashtags";
import { alphaShareText } from "./forum-alpha-editorial";
test("carries explicit reviewed tickers, excluding amounts and code", () => {
  expect(
    publicationCashtags(
      "Solana ($sol), $PUMP and $SOL. Raised $500 and $1.2 million. [code]echo $HOME[/code]",
    ),
  ).toEqual(["$SOL", "$PUMP"]);
  expect(publicationCashtags("Bagsapp @project has a 5m cap")).toEqual([]);
  const text = alphaShareText(
    "Project announces an integration",
    "https://forum.symbaiex.com/crypto/project",
    ["project"],
    ["$SOL"],
  );
  expect(text).toContain("$SOL @project");
  expect(
    alphaShareText(
      "Project ($SOL) ships",
      "https://forum.symbaiex.com/crypto/project",
      [],
      ["$SOL"],
    )?.match(/\$SOL/g),
  ).toHaveLength(1);
});
