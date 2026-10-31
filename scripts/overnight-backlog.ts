import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type BuildTask = {
  id: string;
  title: string;
  area: string;
  priority: "P0" | "P1" | "P2";
  kind: "bug" | "feature" | "ux" | "test" | "operational";
  evidence: string;
  acceptance: string;
  dependsOn: string[];
  status:
    | "queued"
    | "in_progress"
    | "implemented"
    | "tested"
    | "merged"
    | "deployed"
    | "blocked"
    | "needs_confirmation";
  paths?: string[];
  authorization?: string;
  receipt?: string;
};

const statuses = new Set([
  "queued",
  "in_progress",
  "implemented",
  "tested",
  "merged",
  "deployed",
  "blocked",
  "needs_confirmation",
]);
const kinds = new Set(["bug", "feature", "ux", "test", "operational"]);
const priorities = ["P0", "P1", "P2"];

/** A planning aid only: never starts agents, commands, provider requests or releases. */
export function validateBacklog(value: unknown): BuildTask[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000)
    throw new Error("Expected between 1 and 1000 backlog tasks.");
  const tasks = value as BuildTask[];
  const byId = new Map<string, BuildTask>();
  for (const task of tasks) {
    if (
      !task ||
      typeof task !== "object" ||
      typeof task.id !== "string" ||
      !/^[A-Z]+-\d{3}$/.test(task.id)
    )
      throw new Error("Every task needs a stable lane-prefixed ID.");
    if (byId.has(task.id)) throw new Error(`Duplicate task: ${task.id}`);
    for (const field of ["title", "area", "evidence", "acceptance"] as const)
      if (typeof task[field] !== "string" || !task[field].trim())
        throw new Error(`${task.id}: missing ${field}`);
    if (
      !priorities.includes(task.priority) ||
      !kinds.has(task.kind) ||
      !statuses.has(task.status)
    )
      throw new Error(`${task.id}: invalid classification`);
    if (
      !Array.isArray(task.dependsOn) ||
      task.dependsOn.some((id) => typeof id !== "string") ||
      new Set(task.dependsOn).size !== task.dependsOn.length
    )
      throw new Error(`${task.id}: invalid dependencies`);
    if (
      task.paths !== undefined &&
      (!Array.isArray(task.paths) ||
        task.paths.length === 0 ||
        task.paths.some((path) => !safePath(path)))
    )
      throw new Error(`${task.id}: invalid ownership paths`);
    if (
      task.authorization !== undefined &&
      (typeof task.authorization !== "string" || !task.authorization.trim())
    )
      throw new Error(`${task.id}: invalid authorization requirement`);
    if (
      task.status === "deployed" &&
      (typeof task.receipt !== "string" || !task.receipt.trim())
    )
      throw new Error(`${task.id}: deployed work needs a release receipt`);
    byId.set(task.id, task);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new Error(`Missing dependency: ${id}`);
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  return tasks;
}

function safePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !/[\\*?]/.test(path) &&
    !path.split("/").some((part) => part === ".." || part === "." || !part)
  );
}

function overlaps(left: string, right: string) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

/** Only explicit path ownership can enter a parallel batch; missing scopes need triage. */
export function readyBatch(value: unknown, limit = 4): BuildTask[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5)
    throw new Error("Batch limit must be between 1 and 5.");
  const tasks = validateBacklog(value);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const active = tasks.filter((task) => task.status === "in_progress");
  const capacity = limit - active.length;
  if (capacity <= 0) return [];
  const owned = active.flatMap((task) => task.paths ?? []);
  // An active task with unspecified ownership makes safe parallel dispatch unknowable.
  if (tasks.some((task) => task.status === "in_progress" && !task.paths))
    return [];
  const batch: BuildTask[] = [];
  for (const task of [...tasks].sort(
    (a, b) =>
      priorities.indexOf(a.priority) - priorities.indexOf(b.priority) ||
      a.id.localeCompare(b.id),
  )) {
    if (
      task.status !== "queued" ||
      !task.paths ||
      task.authorization ||
      task.dependsOn.some((id) => byId.get(id)?.status !== "deployed")
    )
      continue;
    if (task.paths.some((path) => owned.some((scope) => overlaps(path, scope))))
      continue;
    batch.push(task);
    owned.push(...task.paths);
    if (batch.length >= capacity) break;
  }
  return batch;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const tasks = validateBacklog(
    JSON.parse(
      readFileSync(
        new URL("../docs/overnight-backlog.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  if (process.argv.includes("--ready")) {
    console.log(
      JSON.stringify(
        readyBatch(tasks).map(({ id, title, paths }) => ({ id, title, paths })),
        null,
        2,
      ),
    );
  } else {
    const counts = Object.fromEntries(
      [...statuses].map((status) => [
        status,
        tasks.filter((task) => task.status === status).length,
      ]),
    );
    console.log(
      JSON.stringify({ valid: true, tasks: tasks.length, counts }, null, 2),
    );
  }
}
