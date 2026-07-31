import { z } from "zod";

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "Expected an HTTP(S) URL");

const newsletterStorySchema = z.object({
  hnItemId: z.number().int().positive(),
  title: z.string().min(1),
  host: z.string().optional(),
  sourceUrl: httpUrlSchema,
  discussionUrl: httpUrlSchema,
  siteUrl: httpUrlSchema,
  imageUrl: httpUrlSchema.optional(),
  imageAlt: z.string().optional(),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  takeaways: z.array(z.string().min(1)).min(1),
  signalScore: z.number().min(0).max(100),
});

const newsletterSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});

export const editorialNewsletterPayloadSchema = z.object({
  kind: z.literal("editorial-newsletter"),
  version: z.literal(2),
  edition: z.enum(["daily-signal", "weekly-field-note"]),
  runDate: z.string().min(10),
  snapshotDate: z.string().min(10),
  generatedAt: z.number(),
  siteUrl: httpUrlSchema,
  newsUrl: httpUrlSchema,
  archiveUrl: httpUrlSchema,
  author: z.object({
    name: z.literal("Belle"),
    role: z.string().min(1),
    disclosure: z.string().min(1),
  }),
  headline: z.string().min(1),
  dek: z.string().min(1),
  thesis: z.string().min(1),
  lead: z.string().min(1),
  heroImage: z
    .object({
      url: httpUrlSchema,
      alt: z.string().min(1),
      credit: z.string().optional(),
      sourceUrl: httpUrlSchema.optional(),
    })
    .optional(),
  stories: z.array(newsletterStorySchema).min(1),
  sections: z.array(newsletterSectionSchema).optional(),
  chart: z.object({
    title: z.string().min(1),
    subtitle: z.string().min(1),
    metricLabel: z.string().min(1),
    items: z
      .array(
        z.object({
          label: z.string().min(1),
          value: z.number().min(0).max(100),
          note: z.string().min(1),
        }),
      )
      .min(3)
      .max(6),
  }),
  practicalMoves: z.array(z.string().min(1)).min(2),
  whatToWatch: z.array(z.string().min(1)).min(2),
  discussion: z.object({
    question: z.string().min(1),
    forumUrl: httpUrlSchema.optional(),
  }),
  methodology: z.string().min(1),
  quality: z.object({
    score: z.number().min(0).max(100),
    sourceCoverage: z.number().min(0).max(100),
    sourceDiversity: z.number().min(0).max(100),
    originality: z.number().min(0).max(100),
    utility: z.number().min(0).max(100),
    notes: z.array(z.string()),
  }),
});

export type EditorialNewsletterPayload = z.infer<
  typeof editorialNewsletterPayloadSchema
>;
export type EditorialNewsletterStory =
  EditorialNewsletterPayload["stories"][number];

export function parseEditorialNewsletterPayload(value: string) {
  try {
    const parsed = editorialNewsletterPayloadSchema.safeParse(
      JSON.parse(value),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function editorialWordCount(payload: EditorialNewsletterPayload) {
  const text = [
    payload.dek,
    payload.thesis,
    payload.lead,
    ...payload.stories.flatMap((story) => [
      story.summary,
      story.whyItMatters,
      ...story.takeaways,
    ]),
    ...(payload.sections ?? []).flatMap((section) => [
      section.heading,
      section.body,
    ]),
    ...payload.practicalMoves,
    ...payload.whatToWatch,
    payload.discussion.question,
  ].join(" ");
  return text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length ?? 0;
}
