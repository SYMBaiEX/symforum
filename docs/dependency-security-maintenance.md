# Glob and minimatch security maintenance

The root application and `workers/eliza-shadow` have independent Bun lockfiles.
Both pin Bun 1.4.2. `workers/eliza-shadow-gateway` has a third independent lockfile.
Run the existing `bun run deps:audit` command to audit all three without exclusions
or advisory suppressions.

## Reviewed dependency changes

- `glob` declared in the 13.x range resolves to the real upstream 14.0.3 release.
  The [cancellation advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
  affects 9.0.0 through 14.0.1 and identifies 14.0.2 as the first fix.
- `minimatch` declared in the 10.x range resolves to upstream 11.0.3. Its
  [pattern-amplification advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  lists every release below 11.0.1 as affected. The report describes the
  `optimizationLevel >= 2` preprocessing in 10.2.6; this migration does not claim
  that the same code path or exploit was demonstrated in legacy 3.x.
- The root's legacy 3.x minimatch declarations also resolve to upstream 11.0.3,
  with the five compatibility patches below. No package is relabeled as a fixed
  release, and no advisory is ignored.

These are version-scoped [Bun overrides](https://bun.com/docs/pm/overrides), not
unbounded major-version overrides. Their resolution and frozen installation are
verified using the repository's pinned Bun version. The necessary upstream
dependency changes include the nonrecursive matcher, path-scurry 3 and the modern
brace-expansion/balanced-match chain. Eliza core and plugin-sql remain at 1.7.2.

## Why five consumer patches are necessary

Minimatch 11 removes the callable default export and `makeRe`. Blindly resolving
legacy callers to 11 breaks linting even when the security audit is green.
Version-bound [Bun patches](https://bun.com/docs/pm/cli/patch) adapt only these
published consumers:

| Pinned consumer | Compatibility adaptation |
| --- | --- |
| eslint-plugin-import 2.32.0 | Six callable uses become named `minimatch` calls. `no-internal-modules` uses `Minimatch.match` instead of building a regular expression. |
| eslint-plugin-react 7.37.5 | Five rules import the named matcher. |
| eslint-plugin-jsx-a11y 6.10.2 | Two accessibility helpers use the named matcher. |
| @eslint/config-array 0.21.2 | ESM namespace import and public ESM/CJS declaration aliases use the modern module and `Minimatch` types. |
| @eslint/eslintrc 3.3.6 | The ESM override tester imports the named `Minimatch` class. |

ESLint and npm-run-all already consume compatible `Minimatch`/`match` APIs.
The existing Better Auth patch is separate and unchanged. No application,
agent, payment, quota, schedule or uncertain-outcome handling is patched here.

The rules retain existing allow/forbid, normalized and resolved-path branches.
One existing policy edge is explicitly tested rather than changed: the import
rule checks both `path` and `/path`, so a negated forbid pattern can match the
prefixed alternative. Minimatch's upstream 11 semantics, including hidden-file
matching and the removal of the old regular-expression API, are intentional;
this is not a replacement regex shim or a guarantee for every possible historic
glob pattern.

## Verification and upkeep

Install both graphs before running compatibility tests:

```sh
bun install --frozen-lockfile --ignore-scripts
bun install --cwd workers/eliza-shadow --frozen-lockfile --ignore-scripts
bunx vitest run scripts/dependency-security.test.ts scripts/dependency-consumers.test.ts
bunx eslint scripts/dependency-security.test.ts scripts/dependency-consumers.test.ts
bun run typecheck
bun run --cwd workers/eliza-shadow build
bun run --cwd workers/eliza-shadow test
bun run deps:audit
```

Tests resolve dependencies from the actual consuming packages. They cover glob
async/sync/extglob/ignore/file-type behavior, cancellation while a directory read
completes, and the amplification pattern in a timeout-bounded child process.
Actual ESLint rules cover all migrated callable sites, raw/resolved allowlists,
forbid lists, negation, Windows separator normalization and hidden files.
Separate Node processes load real ESM support entry points. TypeScript checks
both config-array public declaration formats with `skipLibCheck: false`.
Worker tests use mocked providers and local storage, not production inference.

Keep patches version-bound. When a parent publishes native support for the
modern matcher, review its release, remove only the now-unnecessary patch and
rerun the same tests plus the full repository checks. Do not drop the overrides
until all independently locked graphs resolve outside the affected ranges.
