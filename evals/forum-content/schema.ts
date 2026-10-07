import { z } from "zod";

export const forumContentStyleSchema = z.enum([
  "short_discovery", "social_question", "build_log", "help_question", "help_reply",
  "source_correction", "news_brief", "practical_guide", "comparison", "deep_dive", "digest", "thread",
]);

const evidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["primary", "observation", "hypothesis", "community_context"]),
  text: z.string().min(1),
  url: z.url().optional(),
  synthetic: z.literal(true),
  claimScope: z.string().min(1),
}).strict();

export const forumContentCaseSchema = z.object({
  id: z.string().min(1),
  split: z.enum(["train", "holdout"]),
  family: z.string().min(1),
  task: z.enum(["create", "reply", "abstain"]),
  style: forumContentStyleSchema,
  depth: z.enum(["short", "medium", "long"]),
  audience: z.string().min(1),
  instruction: z.string().min(1),
  context: z.object({
    board: z.string().min(1),
    actor: z.string().min(1),
    priorMessages: z.array(z.object({ author: z.string(), isAgent: z.boolean(), body: z.string() }).strict()),
    availableImages: z.array(z.object({ id: z.string(), description: z.string(), provenance: z.string() }).strict()),
    recentTopics: z.array(z.string()),
  }).strict(),
  evidence: z.array(evidenceSchema),
  researchSourceIds: z.array(z.string()),
  expected: z.object({
    publicationDecision: z.enum(["publish", "abstain"]),
    wordRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    mustInclude: z.array(z.string()),
    mustAvoid: z.array(z.string()),
    requiredSourceIds: z.array(z.string()),
    checks: z.array(z.object({
      kind: z.enum(["contains", "not_contains", "regex", "not_regex"]),
      value: z.string().min(1),
      reason: z.string().min(1),
    }).strict()),
    evaluatorNotes: z.string().min(1),
  }).strict(),
}).strict();

export const forumContentDatasetSchema = z.object({
  version: z.literal("symbaiex-forum-content-v1"),
  createdAt: z.literal("2026-10-07"),
  purpose: z.string(),
  sourceResearch: z.array(z.object({
    id: z.string(),
    url: z.url(),
    platform: z.enum(["x", "reddit", "author_copy", "forum_audit"]),
    access: z.enum(["read", "author_copy_read", "unavailable"]),
    observations: z.array(z.string()),
    limitation: z.string(),
  }).strict()),
  cases: z.array(forumContentCaseSchema).min(36),
}).strict();

export type ForumContentCase = z.infer<typeof forumContentCaseSchema>;
export type ForumContentDataset = z.infer<typeof forumContentDatasetSchema>;
