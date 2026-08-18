// @vitest-environment node
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FileTokenStore } from "./token-store";

describe("FileTokenStore", () => {
  test("creates a mode-0600 token file and refuses to overwrite it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-"));
    const path = join(directory, "token");
    const store = new FileTokenStore(path);
    await store.setToken("private-token");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe("private-token\n");
    await expect(store.setToken("replacement-token")).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(path, "utf8")).toBe("private-token\n");
  });
});
