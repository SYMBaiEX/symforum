// @vitest-environment node
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const require = createRequire(import.meta.url);
const eslint = require("eslint") as typeof import("eslint");
const nextRequire = createRequire(require.resolve("eslint-config-next"));
const importPlugin = nextRequire("eslint-plugin-import");
const reactPlugin = nextRequire("eslint-plugin-react");
const a11yRequire = createRequire(nextRequire.resolve("eslint-plugin-jsx-a11y"));
const eslintRequire = createRequire(require.resolve("eslint"));

function lint(source: string, plugin: "import" | "react", rule: string, options: object, filename = resolve(".dependency-fixture.js")) {
  return new eslint.Linter().verify(source, [{
    files: ["**/*.js"],
    plugins: { import: importPlugin, react: reactPlugin },
    languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { "import/internal-regex": "^@fixture/", react: { version: "19.3.1" } },
    rules: { [`${plugin}/${rule}`]: ["error", options] },
  }], { filename });
}

describe("published lint consumers migrated to the modern matcher", () => {
  it.each([
    ["@fixture/public/one", { forbid: ["@fixture/private/**"] }, 0],
    ["@fixture/private/one", { forbid: ["@fixture/private/**"] }, 1],
    // The existing rule checks both path and /path. Negation therefore matches
    // the prefixed alternative too; this migration intentionally retains it.
    ["@fixture/private/one", { forbid: ["!@fixture/private/**"] }, 1],
    ["@fixture/public/one", { forbid: ["!@fixture/private/**"] }, 1],
    ["@fixture/.hidden/one", { forbid: ["@fixture/**"] }, 0],
    ["@fixture/.hidden/one", { forbid: ["@fixture/.hidden/**"] }, 1],
    ["@fixture/private/../public/one", { forbid: ["@fixture/private/**"] }, 0],
    ["@fixture\\private\\one", { forbid: ["@fixture/private/**"] }, 1],
  ])("no-internal-modules preserves normalized forbid semantics for %s", (path, options, count) => {
    const messages = lint(`import value from ${JSON.stringify(path)};`, "import", "no-internal-modules", options);
    expect(messages).toHaveLength(count);
    if (count) expect(messages[0].ruleId).toBe("import/no-internal-modules");
  });

  it("no-internal-modules handles raw and resolved allow/forbid branches", () => {
    const importPath = "eslint/lib/api.js";
    expect(lint(`import value from '${importPath}';`, "import", "no-internal-modules", { allow: ["eslint/lib/**"] })).toEqual([]);
    const blocked = lint(`import value from '${importPath}';`, "import", "no-internal-modules", { allow: ["!eslint/lib/**"] });
    // Existing behavior checks both raw and resolved paths: use an exact resolved
    // allowlist to exercise the filesystem branch without changing that policy.
    const fullPath = resolve("node_modules/eslint/lib/api.js");
    expect(lint(`import value from '${importPath}';`, "import", "no-internal-modules", { allow: [fullPath] })).toEqual([]);
    expect(lint(`import value from '${importPath}';`, "import", "no-internal-modules", { forbid: [fullPath] })).toHaveLength(1);
    expect(blocked.every((message) => !message.fatal)).toBe(true);
    expect(lint(`import value from '${importPath}';`, "import", "no-internal-modules", { allow: ["elsewhere/**"] })).toHaveLength(1);
  });

  it("default-callable import rules use the actual named function", () => {
    expect(lint("import './style.css';", "import", "no-unassigned-import", { allow: ["**/*.css"] })).toEqual([]);
    expect(lint("import './style.css';", "import", "no-unassigned-import", { allow: ["**/*.js"] })).toHaveLength(1);
    expect(lint("import * as item from 'allowed/module';", "import", "no-namespace", { ignore: ["allowed/**"] })).toEqual([]);
    expect(lint("import * as item from 'blocked/module';", "import", "no-namespace", { ignore: ["allowed/**"] })).toHaveLength(1);
    const mixed = "import item from 'node:path'; module.exports=item;";
    expect(lint(mixed, "import", "no-import-module-exports", { exceptions: [resolve(".dependency-fixture.js")] })).toEqual([]);
    expect(lint(mixed, "import", "no-import-module-exports", { exceptions: ["**/other.js"] })).toHaveLength(1);
    expect(lint("import 'vitest';", "import", "no-extraneous-dependencies", { devDependencies: [resolve(".dependency-fixture.js")] })).toEqual([]);
    expect(lint("import 'vitest';", "import", "no-extraneous-dependencies", { devDependencies: ["**/other.js"] })).toHaveLength(1);
    expect(lint("import value from 'allowed/file.js';", "import", "extensions", { pattern: { js: "never" }, pathGroupOverrides: [{ pattern: "allowed/**", action: "ignore" }] })).toEqual([]);
    const ordered = lint("import a from '@fixture/a'; import z from '@fixture/z';", "import", "order", { groups: ["external", "internal"], pathGroupsExcludedImportTypes: [], pathGroups: [{ pattern: "@fixture/z", group: "external", position: "before" }] });
    expect(ordered.some((message) => message.ruleId === "import/order")).toBe(true);
  });

  it("React custom-component patterns still enforce rather than skip the rule", () => {
    expect(lint("const view=<ArticleBody dangerouslySetInnerHTML={{__html:'text'}} />;", "react", "no-danger", { customComponentNames: ["Article*"] })).toHaveLength(1);
    expect(lint("const view=<OtherBody dangerouslySetInnerHTML={{__html:'text'}} />;", "react", "no-danger", { customComponentNames: ["Article*"] })).toEqual([]);
    const options = { forbid: [{ propName: "style", allowedForPatterns: ["Safe*"] }] };
    expect(lint("const view=<SafeCard style={{}} />;", "react", "forbid-component-props", options)).toEqual([]);
    expect(lint("const view=<OtherCard style={{}} />;", "react", "forbid-component-props", options)).toHaveLength(1);
    expect(lint("const view=<Bad_name />;", "react", "jsx-pascal-case", { ignore: ["Bad_*"] })).toEqual([]);
    expect(lint("const view=<Bad_name />;", "react", "jsx-pascal-case", { ignore: ["Other_*"] })).toHaveLength(1);
    const handler = "const view=<Widget onClick={doThing} />;";
    expect(lint(handler, "react", "jsx-handler-names", { checkLocalVariables: true, ignoreComponentNames: ["Wid*"] })).toEqual([]);
    expect(lint(handler, "react", "jsx-handler-names", { checkLocalVariables: true, ignoreComponentNames: ["Other*"] })).toHaveLength(1);
    const nested = "function App(){return <List cellRenderer={()=><div />} />;}";
    expect(lint(nested, "react", "no-unstable-nested-components", { propNamePattern: "cell*" })).toEqual([]);
    expect(lint(nested, "react", "no-unstable-nested-components", { propNamePattern: "render*" })).toHaveLength(1);
  });

  it("accessibility helpers match child and control patterns", () => {
    const contains = a11yRequire("./util/mayContainChildComponent");
    const labelled = a11yRequire("./util/mayHaveAccessibleLabel");
    const node = { type: "JSXElement", openingElement: { name: { type: "JSXIdentifier", name: "IconButton" }, attributes: [] }, children: [] };
    expect(contains({ children: [node] }, "Icon*")).toBe(true);
    expect(contains({ children: [node] }, "Label*")).toBe(false);
    expect(labelled(node, 1, [], () => "IconButton", ["Icon*"])).toBe(false);
    expect(labelled(node, 1, [], () => "IconButton", ["Other*"])).toBe(true);
  });

  it("retains npm-run-all colon patterns, ordering and de-duplication", () => {
    const runnerRequire = createRequire(require.resolve("npm-run-all"));
    const matchTasks = runnerRequire("./match-tasks");
    expect(matchTasks(["dev:frontend", "dev:backend", "build:forum"], ["dev:*", "dev:frontend"])).toEqual(["dev:frontend", "dev:backend"]);
    expect(matchTasks(["build:forum", "build:platform", "test"], ["build:{forum,platform}"])).toEqual(["build:forum", "build:platform"]);
  });

  it("loads the real ESM and CJS ESLint support entry points", () => {
    const configEntry = eslintRequire.resolve("@eslint/config-array");
    const esmConfig = pathToFileURL(join(dirname(configEntry), "../esm/index.js")).href;
    const eslintrcRoot = dirname(eslintRequire.resolve("@eslint/eslintrc/package.json"));
    const esmLegacy = pathToFileURL(join(eslintrcRoot, "lib/index.js")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `const a=await import(${JSON.stringify(esmConfig)});const b=await import(${JSON.stringify(esmLegacy)});const c=new a.ConfigArray([{files:['**/*.js']}],{basePath:'/project'});await c.normalize();if(!c.getConfig('/project/.hidden/file.js'))throw Error('hidden config missing');if(typeof b.Legacy.ConfigArrayFactory!=='function')throw Error('legacy ESM missing');`], { encoding: "utf8", timeout: 5000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(typeof eslintRequire("@eslint/config-array").ConfigArray).toBe("function");
    expect(typeof eslintRequire("@eslint/eslintrc").Legacy.ConfigArrayFactory).toBe("function");
  });

  it.each(["mts", "cts"])("checks config-array public %s declarations with skipLibCheck false", (extension) => {
    const entry = eslintRequire.resolve("@eslint/config-array");
    const directory = join(dirname(entry), "../..");
    const filename = join(directory, `__sym_dependency_types.${extension}`);
    const publicEntry = extension === "mts" ? "./dist/esm/index.js" : "./dist/cjs/index.cjs";
    const source = `import {ConfigArray,type IMinimatch,type IMinimatchStatic} from '${publicEntry}';import * as matcher from 'minimatch';const api:IMinimatchStatic=matcher;const pattern:IMinimatch=new api.Minimatch('**/*.ts');const config=new ConfigArray([]);pattern.match('one.ts');void config;`;
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: false, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, types: ["node"], typeRoots: [resolve("node_modules/@types")], allowImportingTsExtensions: true };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    host.readFile = (file) => file === filename ? source : originalRead(file);
    host.fileExists = (file) => file === filename || originalExists(file);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n" })).toBe("");
  });
});
