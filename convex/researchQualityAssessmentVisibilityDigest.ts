import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type AssessmentVisibility = Pick<
  Doc<"researchQualityAssessments">,
  "_id" | "threadId" | "authorUserId" | "status"
>;

function visibilityDigestFromAssessment(assessment: AssessmentVisibility) {
  if (assessment.threadId === undefined) return null;
  return {
    assessmentId: assessment._id,
    threadId: assessment.threadId,
    authorUserId: assessment.authorUserId,
    status: assessment.status,
  };
}

function sameFields(
  left: Doc<"researchQualityAssessmentVisibilityDigests">,
  right: NonNullable<ReturnType<typeof visibilityDigestFromAssessment>>,
) {
  return (
    left.assessmentId === right.assessmentId &&
    left.threadId === right.threadId &&
    left.authorUserId === right.authorUserId &&
    left.status === right.status
  );
}

/** Keep the export-only visibility projection transactionally aligned. */
export async function upsertResearchQualityAssessmentVisibilityDigest(
  ctx: MutationCtx,
  assessment: AssessmentVisibility,
) {
  const values = visibilityDigestFromAssessment(assessment);
  // Private, pre-publication assessments never participate in evidence
  // visibility. Avoid even an indexed lookup for those frequent writes.
  if (values === null) return null;
  const byAssessmentId = await ctx.db
    .query("researchQualityAssessmentVisibilityDigests")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessment._id))
    .unique();

  const byThreadId =
    byAssessmentId === null
      ? await ctx.db
          .query("researchQualityAssessmentVisibilityDigests")
          .withIndex("by_threadId", (q) => q.eq("threadId", values.threadId))
          .unique()
      : null;
  const existing = byAssessmentId ?? byThreadId;
  if (existing === null)
    return await ctx.db.insert(
      "researchQualityAssessmentVisibilityDigests",
      values,
    );
  if (!sameFields(existing, values))
    await ctx.db.patch(
      "researchQualityAssessmentVisibilityDigests",
      existing._id,
      values,
    );
  return existing._id;
}

export async function deleteResearchQualityAssessmentVisibilityDigest(
  ctx: MutationCtx,
  assessmentId: Id<"researchQualityAssessments">,
) {
  const existing = await ctx.db
    .query("researchQualityAssessmentVisibilityDigests")
    .withIndex("by_assessmentId", (q) => q.eq("assessmentId", assessmentId))
    .unique();
  if (existing !== null)
    await ctx.db.delete(
      "researchQualityAssessmentVisibilityDigests",
      existing._id,
    );
}
