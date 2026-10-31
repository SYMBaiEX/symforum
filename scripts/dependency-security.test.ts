// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const emailRequire = createRequire(require.resolve("react-email"));
const workerRequire = createRequire(new URL("../workers/eliza-shadow/package.json", import.meta.url));
const coreRequire = createRequire(workerRequire.resolve("@elizaos/core"));
type GlobOptions = {
  cwd: string;
  nodir?: boolean;
  ignore?: string[];
  signal?: AbortSignal;
  fs?: typeof fs;
};
type GlobApi = {
  glob(pattern: string, options: GlobOptions & { withFileTypes: true }): Promise<{ name: string }[]>;
  glob(pattern: string, options: GlobOptions): Promise<string[]>;
  globSync(pattern: string, options: GlobOptions): string[];
};

// Exercise consumers' actual resolved dependencies, not a direct test-only copy.
for (const [label, consumer] of [["react-email", emailRequire], ["Eliza core", coreRequire]] as const) {
  describe(`${label} security override compatibility`, () => {
    const glob = consumer("glob") as GlobApi;
    const globRequire = createRequire(consumer.resolve("glob"));

    it("resolves the reviewed patched versions under Bun 1.4.2", () => {
      expect(consumer("glob/package.json").version).toBe("14.0.3");
      expect(globRequire("minimatch/package.json").version).toBe("11.0.3");
      expect(workerRequire("@elizaos/core/package.json").version).toBe("1.7.2");
    });

    it("retains named async/sync APIs, extglobs, ignore and file-type options", async () => {
      const directory = await mkdtemp(join(tmpdir(), "sym-glob-compat-"));
      try {
        await mkdir(join(directory, "nested"));
        await Promise.all(["one.ts", "two.js", "nested/three.ts", "nested/ignore.ts"].map((file) => writeFile(join(directory, file), "")));
        const options = { cwd: directory, nodir: true, ignore: ["**/ignore.ts"] };
        const expected = ["nested/three.ts", "one.ts", "two.js"];
        expect((await glob.glob("**/*.@(js|ts)", options)).sort()).toEqual(expected);
        expect(glob.globSync("**/*.@(js|ts)", options).sort()).toEqual(expected);
        expect((await glob.glob("**/*.ts", { ...options, withFileTypes: true })).map((entry) => entry.name).sort()).toEqual(["one.ts", "three.ts"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("stops directory traversal when cancellation races a completed readdir", async () => {
      const directory = await mkdtemp(join(tmpdir(), "sym-glob-abort-"));
      const controller = new AbortController();
      let reads = 0;
      try {
        await mkdir(join(directory, "nested"));
        await writeFile(join(directory, "nested", "one.ts"), "");
        const guardedFs = {
          ...fs,
          readdir(path: fs.PathLike, options: unknown, callback: (error: NodeJS.ErrnoException | null, entries: unknown) => void) {
            reads++;
            fs.readdir(path, options as { withFileTypes: true }, (error, entries) => {
              controller.abort();
              callback(error, entries);
            });
          },
        };
        await expect(glob.glob("**/*.ts", { cwd: directory, signal: controller.signal, fs: guardedFs as unknown as typeof fs })).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(reads).toBe(1);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("bounds the advisory amplification case in an isolated process", () => {
      const resolved = globRequire.resolve("minimatch");
      const result = spawnSync(process.execPath, ["-e", `const {Minimatch}=require(${JSON.stringify(resolved)}); const m=new Minimatch('**/../'.repeat(18)+'*.ts',{optimizationLevel:2}); if(typeof m.match('one.ts')!=='boolean')process.exit(1);`], { timeout: 2000, encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    });
  });
}

it("retains the callable/makeRe legacy API until its consumers are migrated", () => {
  const eslintRequire = createRequire(require.resolve("eslint"));
  const legacy = eslintRequire("minimatch");
  expect(legacy("src/one.ts", "**/*.ts")).toBe(true);
  expect(legacy.makeRe("**/*.ts").test("src/one.ts")).toBe(true);
  const runAllRequire = createRequire(require.resolve("npm-run-all"));
  expect(new (runAllRequire("minimatch").Minimatch)("dev:*", { nonegate: true }).match("dev:frontend")).toBe(true);
});
