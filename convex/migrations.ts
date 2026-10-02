import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import { ensureEvidenceVersionExportDigest } from "./evidenceVersionExportDigest";
import { upsertEvidenceDocumentExportDigest } from "./evidenceDocumentExportDigest";
import { upsertResearchQualityAssessmentVisibilityDigest } from "./researchQualityAssessmentVisibilityDigest";
import { recordNewsletterMetric } from "./newsletterMetrics";
import schema from "./schema";

export const migrations = new Migrations(components.migrations, { schema });

export const backfillEvidenceDocumentVersionExportDigests = migrations.define({
  table: "evidenceDocumentVersions",
  batchSize: 25,
  migrateOne: async (ctx, version) => {
    await ensureEvidenceVersionExportDigest(ctx, version);
  },
});

export const backfillEvidenceDocumentExportDigests = migrations.define({
  table: "evidenceDocuments",
  batchSize: 25,
  migrateOne: async (ctx, document) => {
    await upsertEvidenceDocumentExportDigest(ctx, document);
  },
});

export const backfillResearchQualityAssessmentVisibilityDigests =
  migrations.define({
    table: "researchQualityAssessments",
    batchSize: 25,
    migrateOne: async (ctx, assessment) => {
      await upsertResearchQualityAssessmentVisibilityDigest(ctx, assessment);
    },
  });

/** Run export read-model backfills as one resumable post-deploy series. */
export const backfillEvidenceExportReadModels = migrations.runner([
  internal.migrations.backfillEvidenceDocumentVersionExportDigests,
  internal.migrations.backfillEvidenceDocumentExportDigests,
  internal.migrations.backfillResearchQualityAssessmentVisibilityDigests,
]);

export const backfillNewsletterEventMetrics = migrations.define({
  table: "newsletterEvents",
  batchSize: 25,
  migrateOne: async (ctx, event) => {
    await recordNewsletterMetric(ctx, {
      issueId: event.issueId,
      scope: "email",
      eventType: event.eventType,
      id: String(event._id),
    });
  },
});

export const backfillNewsletterEngagementMetrics = migrations.define({
  table: "newsletterEngagements",
  batchSize: 25,
  migrateOne: async (ctx, engagement) => {
    await recordNewsletterMetric(ctx, {
      issueId: engagement.issueId,
      scope: "engagement",
      eventType: engagement.eventType,
      id: String(engagement._id),
    });
  },
});
