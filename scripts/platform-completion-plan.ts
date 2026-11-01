import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const PROTECTED_ITEMS = [
  1, 2, 3, 20, 49, 53, 61, 62, 68, 69, 83, 86, 98, 99, 100,
] as const;
export const STAGES = [
  "queued",
  "in_progress",
  "ready_review",
  "partial",
  "source_implemented",
  "isolated_tested",
  "merged",
  "source_deployed",
  "live_verified",
  "blocked",
  "needs_decision",
] as const;
const text = z.string().trim().min(1).max(2000);
const id = z.string().regex(/^PLATFORM-(?:00[1-9]|0[1-9]\d|100)$/);
export const safePlanPath = (value: string) =>
  value.length < 500 &&
  !value.startsWith("/") &&
  !/[\\*?%:#\x00-\x1f]/.test(value) &&
  !value
    .split("/")
    .some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        [".git", ".aws", ".codex", ".claude", "node_modules"].includes(part) ||
        /^\.env(?:\.|$)/.test(part),
    ) &&
  /\.[a-z0-9]+$/i.test(value);
const path = z
  .string()
  .refine(safePlanPath, "Expected an exact non-secret repository file path.");
const proofKind = z.enum([
  "source_commit",
  "isolated_tests",
  "merge",
  "deployment",
  "live_proof",
]);
const itemSchema = z
  .object({
    id,
    number: z.number().int().min(1).max(100),
    title: text,
    area: z.enum([
      "identity",
      "trading",
      "data",
      "forum",
      "community",
      "agents",
      "research",
      "developer",
      "accessibility",
      "operations",
      "growth",
    ]),
    status: z.enum(STAGES),
    changeType: z.enum([
      "frontend",
      "backend",
      "cross_stack",
      "tests",
      "operations",
      "decision",
      "documentation",
    ]),
    verification: z
      .array(
        z.enum([
          "unit",
          "backend",
          "browser_fixture",
          "types_lint",
          "five_app_builds",
          "security",
          "public_read_only",
          "provider_read_only",
          "owner_controlled_wallet",
          "human_device",
          "custody_review",
        ]),
      )
      .min(1),
    sourceEvidence: z
      .array(z.object({ path, anchor: text, observation: text }).strict())
      .min(1),
    acceptance: z.array(text).min(1),
    remainingAcceptance: z.array(text).min(1).optional(),
    boundaries: z.array(text).min(1),
    dependencies: z.array(
      z
        .object({
          id,
          requires: z.enum([
            "isolated_tested",
            "source_deployed",
            "live_verified",
          ]),
        })
        .strict(),
    ),
    ownership: z
      .object({ owner: text.nullable(), paths: z.array(path) })
      .strict(),
    blockers: z.array(
      z
        .object({
          kind: z.enum([
            "approval",
            "operational_input",
            "product_decision",
            "external_readiness",
            "live_verification",
          ]),
          phase: z.enum(["implementation", "live_acceptance"]),
          detail: text,
          resolved: z.boolean(),
          receipt: text.optional(),
        })
        .strict(),
    ),
    qualification: z.array(
      z.object({ kind: proofKind, reference: text }).strict(),
    ),
  })
  .strict();
const planSchema = z
  .object({
    version: z.literal(1),
    baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    constraints: z
      .object({
        modelUsdPerDay: z.literal(2),
        swapFeeBps: z.literal(50),
        preserveSchedules: z.literal(true),
        preserveProviderFreeCaps: z.literal(true),
        preserveSafetyGates: z.literal(true),
        preserveHolds: z.literal(true),
        noRealPaymentsByPlanner: z.literal(true),
        noNetworkOrExecution: z.literal(true),
      })
      .strict(),
    items: z.array(itemSchema).length(100),
  })
  .strict();
export type CompletionItem = z.infer<typeof itemSchema>;
export type CompletionPlan = z.infer<typeof planSchema>;
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const stageProofs = {
  ready_review: ["source_commit"],
  partial: ["source_commit", "isolated_tests"],
  source_implemented: ["source_commit"],
  isolated_tested: ["source_commit", "isolated_tests"],
  merged: ["source_commit", "isolated_tests", "merge"],
  source_deployed: ["source_commit", "isolated_tests", "merge", "deployment"],
  live_verified: [
    "source_commit",
    "isolated_tests",
    "merge",
    "deployment",
    "live_proof",
  ],
} as const;

const validateItem = (item: CompletionItem) => {
  if (item.status === "partial" && !item.remainingAcceptance?.length)
    throw Error(`${item.id}: partial delivery requires remaining acceptance`);
  if (
    ["isolated_tested", "merged", "source_deployed", "live_verified"].includes(
      item.status,
    ) &&
    item.remainingAcceptance?.length
  )
    throw Error(`${item.id}: remaining acceptance cannot be labelled complete`);
  if (item.id !== `PLATFORM-${String(item.number).padStart(3, "0")}`)
    throw Error(`${item.id}: number/ID mismatch`);
  if (
    new Set(item.dependencies.map((edge) => edge.id)).size !==
    item.dependencies.length
  )
    throw Error(`${item.id}: duplicate dependency`);
  if (new Set(item.ownership.paths).size !== item.ownership.paths.length)
    throw Error(`${item.id}: duplicate ownership path`);
  if (
    item.status === "in_progress" &&
    (!item.ownership.owner || !item.ownership.paths.length)
  )
    throw Error(`${item.id}: active work requires exact ownership`);
  if (
    PROTECTED_ITEMS.some((number) => number === item.number) &&
    !item.blockers.some((blocker) => blocker.phase === "implementation")
  )
    throw Error(`${item.id}: protected operational boundary is missing`);
  if (item.blockers.some((blocker) => blocker.resolved && !blocker.receipt))
    throw Error(`${item.id}: resolved blocker requires its own receipt`);
  if (
    (item.status === "blocked" || item.status === "needs_decision") &&
    !item.blockers.some((blocker) => !blocker.resolved)
  )
    throw Error(`${item.id}: blocked state needs an unresolved blocker`);
  const needed = stageProofs[item.status as keyof typeof stageProofs] as
    readonly string[] | undefined;
  if (
    needed?.some(
      (kind) => !item.qualification.some((proof) => proof.kind === kind),
    )
  )
    throw Error(`${item.id}: missing stage-specific qualification`);
  if (
    item.status === "ready_review" &&
    (!item.ownership.owner || !item.ownership.paths.length)
  )
    throw Error(`${item.id}: frozen work requires exact ownership`);
  if (
    item.status === "live_verified" &&
    item.blockers.some((blocker) => !blocker.resolved)
  )
    throw Error(`${item.id}: live verification cannot bypass blockers`);
};
const validateGraph = (items: CompletionItem[]) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (
    byId.size !== 100 ||
    new Set(items.map((item) => item.number)).size !== 100
  )
    throw Error("Expected 100 unique stable item IDs and numbers.");
  const active = new Set<string>(),
    done = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) throw Error(`Dependency cycle: ${key}`);
    if (done.has(key)) return;
    const item = byId.get(key);
    if (!item) throw Error(`Missing dependency: ${key}`);
    active.add(key);
    for (const edge of item.dependencies) {
      if (edge.id === key) throw Error(`Self dependency: ${key}`);
      visit(edge.id);
    }
    active.delete(key);
    done.add(key);
  };
  items.forEach((item) => visit(item.id));
};
const validateActiveOwnership = (items: CompletionItem[]) => {
  const active = items.filter(
    (item) => item.status === "in_progress" || item.status === "ready_review",
  );
  for (let i = 0; i < active.length; i++)
    for (const other of active.slice(i + 1)) {
      const current = active[i]!;
      if (
        current.ownership.owner !== other.ownership.owner &&
        current.ownership.paths.some((a) =>
          other.ownership.paths.some((b) => overlaps(a, b)),
        )
      )
        throw Error(`Active ownership collision: ${current.id}/${other.id}`);
    }
};
/** Validates a plan only. A status, receipt string or ready row grants no authority. */
export const validateCompletionPlan = (value: unknown): CompletionPlan => {
  const plan = planSchema.parse(value);
  plan.items.forEach(validateItem);
  validateGraph(plan.items);
  validateActiveOwnership(plan.items);
  return plan;
};
/** Local source anchors document foundations, not proof that requested work is done. */
export const validateSourceEvidence = (
  plan: CompletionPlan,
  read: (file: string) => string,
) => {
  for (const item of plan.items)
    for (const evidence of item.sourceEvidence) {
      if (!read(evidence.path).includes(evidence.anchor))
        throw Error(`${item.id}: source anchor missing in ${evidence.path}`);
    }
};
const meets = (
  status: CompletionItem["status"],
  required: CompletionItem["dependencies"][number]["requires"],
) => {
  if (required === "live_verified") return status === "live_verified";
  if (required === "source_deployed")
    return status === "source_deployed" || status === "live_verified";
  return [
    "isolated_tested",
    "merged",
    "source_deployed",
    "live_verified",
  ].includes(status);
};
/** Dry selection only; never runs commands, creates agents or changes plan state. */
export const readyCompletionBatch = (
  value: unknown,
  limit = 5,
): CompletionItem[] => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5)
    throw Error("Batch limit must be 1–5.");
  const { items } = validateCompletionPlan(value),
    byId = new Map(items.map((item) => [item.id, item]));
  const active = items.filter(
    (item) => item.status === "in_progress" || item.status === "ready_review",
  );
  const owners = new Set(active.map((item) => item.ownership.owner));
  const free = limit - owners.size;
  const owned = active.flatMap((item) => item.ownership.paths),
    batch: CompletionItem[] = [];
  if (free <= 0) return [];
  for (const item of [...items].sort((a, b) => a.number - b.number)) {
    if (
      item.status !== "queued" ||
      !item.ownership.owner ||
      owners.has(item.ownership.owner) ||
      !item.ownership.paths.length ||
      item.blockers.some(
        (blocker) => blocker.phase === "implementation" && !blocker.resolved,
      ) ||
      item.dependencies.some(
        (edge) => !meets(byId.get(edge.id)!.status, edge.requires),
      ) ||
      item.ownership.paths.some((a) => owned.some((b) => overlaps(a, b)))
    )
      continue;
    batch.push(item);
    owned.push(...item.ownership.paths);
    owners.add(item.ownership.owner);
    if (batch.length === free) break;
  }
  return batch;
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.slice(2).some((arg) => arg !== "--ready"))
    throw Error("Only the optional --ready dry-plan flag is supported.");
  const plan = validateCompletionPlan(
    JSON.parse(
      readFileSync(
        new URL("../docs/platform-completion-backlog.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  validateSourceEvidence(plan, (file) =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  );
  console.log(
    JSON.stringify(
      process.argv.includes("--ready")
        ? {
            dryPlan: true,
            ready: readyCompletionBatch(plan).map(
              ({ id, title, ownership }) => ({ id, title, ownership }),
            ),
          }
        : {
            valid: true,
            total: plan.items.length,
            counts: Object.fromEntries(
              STAGES.map((status) => [
                status,
                plan.items.filter((item) => item.status === status).length,
              ]),
            ),
          },
      null,
      2,
    ),
  );
}
