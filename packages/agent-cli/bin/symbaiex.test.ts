// @vitest-environment node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "./symbaiex";

describe("symbaiex login", () => {
  test("stores a stdin token without writing it to stdout or stderr", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-output-"));
    const tokenFile = join(directory, "token");
    const output: string[] = [];
    const errors: string[] = [];
    const secret = "do-not-print-this-token";
    const code = await run(
      ["login", "--token-file", tokenFile],
      {
        log: (value: unknown) => output.push(String(value)),
        error: (value: unknown) => errors.push(String(value)),
      },
      async () => secret,
    );
    expect(code).toBe(0);
    expect(output.join("\n")).not.toContain(secret);
    expect(errors.join("\n")).not.toContain(secret);
    expect(await readFile(tokenFile, "utf8")).toBe(`${secret}\n`);
  });
});
