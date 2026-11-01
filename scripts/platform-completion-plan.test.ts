// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  PROTECTED_ITEMS,
  readyCompletionBatch,
  safePlanPath,
  validateCompletionPlan,
  validateSourceEvidence,
  type CompletionPlan,
  type CompletionItem,
} from "./platform-completion-plan";

const load = (): CompletionPlan =>
  JSON.parse(
    readFileSync(
      new URL("../docs/platform-completion-backlog.json", import.meta.url),
      "utf8",
    ),
  );
const item = (plan: CompletionPlan, number: number) =>
  plan.items.find((row) => row.number === number)!;
const fixture = () => {
  const plan = load();
  for (const row of plan.items) {
    row.status = "queued";
    row.ownership.owner = null;
    row.qualification = [];
  }
  return plan;
};
const assign = (
  plan: CompletionPlan,
  number: number,
  owner: string,
  path: string,
) => {
  const row = item(plan, number);
  row.ownership = { owner, paths: [path] };
  return row;
};
const prove = (
  row: CompletionItem,
  status: "isolated_tested" | "merged" | "source_deployed" | "live_verified",
) => {
  row.status = status;
  row.qualification = [
    "source_commit",
    "isolated_tests",
    ...(status === "isolated_tested" ? [] : ["merge"]),
    ...(["source_deployed", "live_verified"].includes(status)
      ? ["deployment"]
      : []),
    ...(status === "live_verified" ? ["live_proof"] : []),
  ].map((kind) => ({
    kind: kind as CompletionItem["qualification"][number]["kind"],
    reference: "Isolated fixture proof, not a real release or authority.",
  }));
};
describe("all-100 platform completion inventory", () => {
  test("retains every original number with concrete scope, evidence, acceptance and boundaries", () => {
    const plan = validateCompletionPlan(load());
    expect(plan.items).toHaveLength(100);
    expect(
      [...plan.items].map((row) => row.number).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(new Set(plan.items.map((row) => row.title)).size).toBe(100);
    validateSourceEvidence(plan, (path) =>
      readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    );
    for (const row of plan.items) {
      expect(row.acceptance[0]!.length).toBeGreaterThan(70);
      expect(row.boundaries.length).toBeGreaterThanOrEqual(2);
      expect(row.ownership.paths.length).toBeGreaterThan(0);
      expect(row.sourceEvidence[0]!.observation).not.toMatch(
        /fully complete|production certified/i,
      );
    }
    for (const row of plan.items.filter(
      (entry) =>
        entry.status === "source_deployed" || entry.status === "live_verified",
    )) {
      expect(
        row.qualification.some((proof) => proof.kind === "deployment"),
      ).toBe(true);
      if (row.status === "live_verified") {
        expect(
          row.qualification.some((proof) => proof.kind === "live_proof"),
        ).toBe(true);
        expect(
          row.blockers.every((blocker) => blocker.resolved && blocker.receipt),
        ).toBe(true);
      }
    }
  });
  test("rejects removed, duplicate, mismatched and out-of-range IDs", () => {
    const short = load();
    short.items.pop();
    expect(() => validateCompletionPlan(short)).toThrow();
    const duplicate = load();
    duplicate.items[99] = structuredClone(duplicate.items[98]!);
    expect(() => validateCompletionPlan(duplicate)).toThrow("unique");
    const mismatch = load();
    item(mismatch, 10).id = "PLATFORM-011";
    expect(() => validateCompletionPlan(mismatch)).toThrow("mismatch");
    const outside = load();
    (outside.items[0] as unknown as { id: string }).id = "PLATFORM-101";
    expect(() => validateCompletionPlan(outside)).toThrow();
  });
  test("rejects missing dependency IDs, self edges, duplicate edges and DAG cycles", () => {
    const missing = load();
    item(missing, 6).dependencies = [
      { id: "PLATFORM-999", requires: "source_deployed" },
    ];
    expect(() => validateCompletionPlan(missing)).toThrow();
    const self = load();
    item(self, 6).dependencies = [
      { id: "PLATFORM-006", requires: "source_deployed" },
    ];
    expect(() => validateCompletionPlan(self)).toThrow("Self");
    const duplicate = load();
    item(duplicate, 6).dependencies = [
      { id: "PLATFORM-004", requires: "source_deployed" },
      { id: "PLATFORM-004", requires: "source_deployed" },
    ];
    expect(() => validateCompletionPlan(duplicate)).toThrow(
      "duplicate dependency",
    );
    const cycle = load();
    item(cycle, 6).dependencies = [
      { id: "PLATFORM-007", requires: "source_deployed" },
    ];
    expect(() => validateCompletionPlan(cycle)).toThrow("cycle");
  });
  test("rejects unsupported states, empty evidence and unsafe ownership paths", () => {
    for (const changes of [
      { status: "done" },
      { title: "" },
      { acceptance: [] },
      { sourceEvidence: [] },
      { changeType: "execute" },
    ]) {
      const plan = load();
      Object.assign(item(plan, 6), changes);
      expect(() => validateCompletionPlan(plan)).toThrow();
    }
    for (const path of [
      "../secrets",
      "/tmp/file.ts",
      "components/../auth.ts",
      "components/*.tsx",
      "components/file?.tsx",
      "components",
      ".git/config",
      ".env.local",
      "node_modules/provider.ts",
      "components\\file.ts",
      "file\u0000.ts",
      "C:/private/file.ts",
      "components/%2e%2e/secret.ts",
      "components/fragment#name.ts",
    ]) {
      expect(safePlanPath(path), path).toBe(false);
      const plan = load();
      item(plan, 6).ownership.paths = [path];
      expect(() => validateCompletionPlan(plan), path).toThrow();
    }
    expect(safePlanPath("apps/platform/app/forum/[slug]/page.tsx")).toBe(true);
  });
  test("requires every protected operational item to retain an explicit boundary", () => {
    const plan = load();
    for (const number of PROTECTED_ITEMS) {
      expect(
        item(plan, number).blockers.some(
          (b) =>
            b.phase === "implementation" && (!b.resolved || Boolean(b.receipt)),
        ),
      ).toBe(true);
      const changed = load();
      item(changed, number).blockers = [];
      expect(() => validateCompletionPlan(changed)).toThrow("protected");
    }
    expect(
      readyCompletionBatch(plan).every((row) =>
        row.blockers.every(
          (blocker) => blocker.phase !== "implementation" || blocker.resolved,
        ),
      ),
    ).toBe(true);
  });
  test("stage labels cannot replace source, isolated, merge, deployment and live receipts", () => {
    for (const status of [
      "ready_review",
      "source_implemented",
      "isolated_tested",
      "merged",
      "source_deployed",
      "live_verified",
    ] as const) {
      const plan = fixture();
      item(plan, 6).status = status;
      expect(() => validateCompletionPlan(plan)).toThrow("qualification");
    }
    const plan = fixture();
    prove(item(plan, 6), "source_deployed");
    expect(() => validateCompletionPlan(plan)).not.toThrow();
    prove(item(plan, 6), "live_verified");
    expect(() => validateCompletionPlan(plan)).toThrow("blockers");
    for (const blocker of item(plan, 6).blockers) {
      blocker.resolved = true;
    }
    expect(() => validateCompletionPlan(plan)).toThrow("receipt");
    for (const blocker of item(plan, 6).blockers)
      blocker.receipt = "Isolated authorization fixture, not real approval.";
    expect(() => validateCompletionPlan(plan)).not.toThrow();
  });
  test("active distinct writers cannot collide but one explicit grouped lane may share files", () => {
    const plan = fixture();
    assign(plan, 6, "one", "components/data.ts").status = "in_progress";
    assign(plan, 8, "two", "components/data.ts").status = "in_progress";
    expect(() => validateCompletionPlan(plan)).toThrow("collision");
    item(plan, 8).status = "ready_review";
    item(plan, 8).qualification = [
      {
        kind: "source_commit",
        reference: "Frozen isolated fixture candidate.",
      },
    ];
    expect(() => validateCompletionPlan(plan)).toThrow("collision");
    item(plan, 8).ownership.owner = "one";
    expect(() => validateCompletionPlan(plan)).not.toThrow();
    item(plan, 8).ownership.paths = [];
    expect(() => validateCompletionPlan(plan)).toThrow("ownership");
  });
  test("dry selection respects dependency evidence, implementation blockers and explicit owners", () => {
    const plan = fixture();
    assign(plan, 6, "data", "components/data.ts");
    assign(plan, 8, "status", "components/status.ts");
    expect(readyCompletionBatch(plan).map((row) => row.number)).toEqual([6]);
    prove(item(plan, 6), "isolated_tested");
    expect(readyCompletionBatch(plan)).toEqual([]);
    prove(item(plan, 6), "source_deployed");
    expect(readyCompletionBatch(plan).map((row) => row.number)).toEqual([8]);
    const blocked = assign(plan, 1, "owner-test", "docs/owner-test.md");
    blocked.dependencies = [];
    expect(readyCompletionBatch(plan).map((row) => row.number)).not.toContain(
      1,
    );
    item(plan, 8).ownership.owner = null;
    expect(readyCompletionBatch(plan)).toEqual([]);
  });
  test("live dependencies cannot be satisfied by source deployment or mock-only evidence", () => {
    const plan = fixture();
    const target = assign(plan, 65, "example", "docs/example.md");
    target.dependencies = [{ id: "PLATFORM-006", requires: "live_verified" }];
    prove(item(plan, 6), "source_deployed");
    expect(readyCompletionBatch(plan)).toEqual([]);
    prove(item(plan, 6), "live_verified");
    item(plan, 6).blockers = [];
    expect(readyCompletionBatch(plan).map((row) => row.number)).toEqual([65]);
  });
  test("ready batches avoid exact and parent-child paths, busy owners and candidate collisions", () => {
    const plan = fixture();
    assign(plan, 6, "active", "components/data.ts").status = "in_progress";
    assign(plan, 25, "collision", "components/data.ts");
    assign(plan, 26, "nested", "components/data.ts/child.ts");
    assign(plan, 28, "active", "components/unrelated.ts");
    assign(plan, 29, "first", "components/risk.ts");
    assign(plan, 30, "second", "components/risk.ts");
    expect(readyCompletionBatch(plan).map((row) => row.number)).toEqual([29]);
  });
  test("selection counts grouped active lanes, bounds capacity and leaves the plan immutable", () => {
    const plan = fixture();
    assign(plan, 12, "grouped", "components/swap.ts").status = "in_progress";
    assign(plan, 18, "grouped", "components/swap.ts").status = "in_progress";
    assign(plan, 6, "data", "components/data.ts");
    assign(plan, 25, "markets", "components/markets.ts");
    const before = JSON.stringify(plan);
    expect(readyCompletionBatch(plan, 2).map((row) => row.number)).toEqual([6]);
    expect(readyCompletionBatch(plan, 1)).toEqual([]);
    expect(JSON.stringify(plan)).toBe(before);
    for (const limit of [0, 6, 1.5, NaN])
      expect(() => readyCompletionBatch(plan, limit)).toThrow("limit");
  });
  test("source anchors fail honestly and the CLI has no execution/network/write mechanism", () => {
    const plan = load();
    expect(() => validateSourceEvidence(plan, () => "unrelated")).toThrow(
      "anchor",
    );
    const source = readFileSync(
      new URL("./platform-completion-plan.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:fetch|spawn|exec|execFile|writeFileSync|mkdirSync|rmSync)\s*\(/,
    );
    expect(source).not.toMatch(/node:(?:http|https|child_process)/);
    expect(source).toContain('arg !== "--ready"');
    const invalid = load();
    invalid.constraints.modelUsdPerDay = 3 as 2;
    expect(() => validateCompletionPlan(invalid)).toThrow();
    const unknown = load() as CompletionPlan & { execute: boolean };
    unknown.execute = true;
    expect(() => validateCompletionPlan(unknown)).toThrow();
  });
});
