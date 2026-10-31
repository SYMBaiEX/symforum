// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  readyBatch,
  validateBacklog,
  type BuildTask,
} from "./overnight-backlog";

const task = (id: string, changes: Partial<BuildTask> = {}): BuildTask => ({
  id,
  title: "A bounded source-backed improvement",
  area: "forum",
  priority: "P1",
  kind: "ux",
  evidence: "components/forum/example.tsx:10",
  acceptance: "Keyboard and pointer users can complete the action.",
  dependsOn: [],
  status: "queued",
  paths: [`components/${id}`],
  ...changes,
});

describe("overnight dependency plan", () => {
  it("validates the checked-in task inventory and its evidence", () => {
    const tasks = validateBacklog(
      JSON.parse(
        readFileSync(
          new URL("../docs/overnight-backlog.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(tasks.length).toBeGreaterThanOrEqual(200);
    expect(tasks.length).toBeLessThanOrEqual(300);
    for (const item of tasks) {
      const match = /^(.+?):(\d+)/.exec(item.evidence);
      expect(match, item.id).not.toBeNull();
      const lines = readFileSync(
        new URL(`../${match![1]}`, import.meta.url),
        "utf8",
      ).split("\n");
      expect(Number(match![2]), item.id).toBeLessThanOrEqual(lines.length);
    }
  });
  it("rejects duplicate IDs, missing dependencies and cycles", () => {
    expect(() => validateBacklog([task("TEST-001"), task("TEST-001")])).toThrow(
      "Duplicate",
    );
    expect(() =>
      validateBacklog([task("TEST-001", { dependsOn: ["TEST-002"] })]),
    ).toThrow("Missing");
    expect(() =>
      validateBacklog([
        task("TEST-001", { dependsOn: ["TEST-002"] }),
        task("TEST-002", { dependsOn: ["TEST-001"] }),
      ]),
    ).toThrow("cycle");
  });
  it("requires evidence, classification, safe ownership and a deployed receipt", () => {
    for (const changes of [
      { evidence: "" },
      { paths: ["../secret"] },
      { paths: ["/tmp"] },
      { paths: ["components/../auth"] },
      { paths: ["components/*.tsx"] },
      { paths: ["components/file?.tsx"] },
      { status: "deployed" as const },
    ])
      expect(() => validateBacklog([task("TEST-001", changes)])).toThrow();
    expect(
      validateBacklog([
        task("TEST-001", {
          status: "deployed",
          receipt: "PR254; release verified",
        }),
      ]),
    ).toHaveLength(1);
    expect(
      validateBacklog([task("TEST-001", { paths: ["app/[slug]/page.tsx"] })]),
    ).toHaveLength(1);
    expect(() =>
      validateBacklog([{ ...task("TEST-001"), id: ["TEST-001"] }]),
    ).toThrow();
    for (const authorization of [null, false, ""])
      expect(() =>
        validateBacklog([{ ...task("TEST-001"), authorization }]),
      ).toThrow();
  });
  it("does not dispatch held, untriaged or approval-dependent work", () => {
    expect(
      readyBatch([
        task("TEST-001", { status: "blocked" }),
        task("TEST-002", { status: "needs_confirmation" }),
        task("TEST-003", { paths: undefined }),
        task("TEST-004", {
          authorization: "Owner must approve a paid upgrade",
        }),
        task("TEST-005"),
      ]).map((item) => item.id),
    ).toEqual(["TEST-005"]);
  });
  it("waits for actual deployed dependencies, not just implemented code", () => {
    const dependent = task("TEST-002", { dependsOn: ["TEST-001"] });
    expect(
      readyBatch([task("TEST-001", { status: "merged" }), dependent]),
    ).toEqual([]);
    expect(
      readyBatch([
        task("TEST-001", {
          status: "deployed",
          receipt: "Live release checked",
        }),
        dependent,
      ]),
    ).toEqual([dependent]);
  });
  it("avoids exact and parent/child ownership collisions with active tasks", () => {
    const tasks = [
      task("TEST-001", { status: "in_progress", paths: ["components/swap"] }),
      task("TEST-002", { paths: ["components/swap/view.tsx"] }),
      task("TEST-003", { paths: ["components"] }),
      task("TEST-004", { paths: ["components/community"] }),
      task("TEST-005", { paths: ["components/community/view.tsx"] }),
    ];
    expect(readyBatch(tasks).map((item) => item.id)).toEqual(["TEST-004"]);
    expect(
      readyBatch([
        ...tasks,
        task("TEST-006", { status: "in_progress", paths: undefined }),
      ]),
    ).toEqual([]);
  });
  it("orders by priority, bounds concurrency and leaves the plan immutable", () => {
    const tasks = [
      task("TEST-001", { priority: "P2" }),
      task("TEST-002", { priority: "P0" }),
      task("TEST-003"),
    ];
    const original = JSON.stringify(tasks);
    expect(readyBatch(tasks, 2).map((item) => item.id)).toEqual([
      "TEST-002",
      "TEST-003",
    ]);
    expect(JSON.stringify(tasks)).toBe(original);
    expect(() => readyBatch(tasks, 6)).toThrow();
    expect(
      readyBatch(
        [
          task("TEST-004", { status: "in_progress" }),
          task("TEST-005", { status: "in_progress" }),
          ...tasks,
        ],
        3,
      ),
    ).toHaveLength(1);
    expect(
      readyBatch([task("TEST-004", { status: "in_progress" }), ...tasks], 1),
    ).toEqual([]);
  });
});
