// @vitest-environment node
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
} from "node:fs/promises";
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

  test("tightens only the explicit existing token directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-parent-"));
    const parent = join(directory, "tokens");
    await chmod(directory, 0o755);
    await mkdir(parent, { mode: 0o755 });
    await chmod(parent, 0o755);
    const store = new FileTokenStore(join(parent, "token"));
    await store.setToken("private-token");
    expect((await stat(parent)).mode & 0o777).toBe(0o700);
    expect((await stat(directory)).mode & 0o777).not.toBe(0o700);
  });

  test("rejects symbolic-link token paths without following them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "symbaiex-cli-link-"));
    const target = join(directory, "target");
    const path = join(directory, "token");
    const targetStore = new FileTokenStore(target);
    await targetStore.setToken("target-token");
    await symlink(target, path);
    const store = new FileTokenStore(path);
    await expect(store.getToken()).rejects.toThrow(/symbolic link/i);
    await expect(store.setToken("replacement-token")).rejects.toThrow(
      /symbolic link/i,
    );
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe("target-token\n");
  });
});
