import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
test("cryptographic transaction builders execute only through the explicit Node runtime", () => {
  const node = readFileSync(
    new URL("./forumCommerceNode.ts", import.meta.url),
    "utf8",
  );
  expect(node).toMatch(/^"use node";/);
  for (const file of ["forumSwaps.ts", "forumPromotions.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(/await build(?:Swap|Promotion)Transaction\(/);
    expect(source).toMatch(
      /ctx\.runAction\(\s*internal\.forumCommerceNode\.build/,
    );
  }
  expect(node).not.toMatch(/(?:globalThis\.)?isSecureContext\s*=/);
  expect(node).not.toMatch(/signAndSend|sendTransaction\s*\(/);
});
