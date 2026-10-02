import { DirectAggregate } from "@convex-dev/aggregate";
import type { ComponentApi } from "@convex-dev/aggregate/_generated/component.js";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type NewsletterMetricScope = "email" | "engagement";
type NewsletterMetricName =
  | "delivered"
  | "opened"
  | "bounced"
  | "complained"
  | "archiveViews"
  | "archiveClicks"
  | "sourceClicks"
  | "discussionClicks"
  | "forumClicks"
  | "newsIndexClicks";

const newsletterMetricsList: readonly {
  name: NewsletterMetricName;
  scope: NewsletterMetricScope;
  eventType: string;
}[] = [
  { name: "delivered", scope: "email", eventType: "email.delivered" },
  { name: "opened", scope: "email", eventType: "email.opened" },
  { name: "bounced", scope: "email", eventType: "email.bounced" },
  { name: "complained", scope: "email", eventType: "email.complained" },
  { name: "archiveViews", scope: "engagement", eventType: "archive_view" },
  { name: "archiveClicks", scope: "engagement", eventType: "archive_click" },
  { name: "sourceClicks", scope: "engagement", eventType: "source_click" },
  {
    name: "discussionClicks",
    scope: "engagement",
    eventType: "discussion_click",
  },
  { name: "forumClicks", scope: "engagement", eventType: "forum_click" },
  {
    name: "newsIndexClicks",
    scope: "engagement",
    eventType: "news_index_click",
  },
];

const analyticsMetricKeys = new Set(
  newsletterMetricsList.map(({ scope, eventType }) => `${scope}:${eventType}`),
);

// Narrow the generated component map to the instance mounted in convex.config.ts.
const newsletterMetricsComponent = (
  components as unknown as {
    newsletterMetrics: ComponentApi<"newsletterMetrics">;
  }
).newsletterMetrics;

const newsletterMetrics = new DirectAggregate<{
  Namespace: Id<"newsletterIssues">;
  Key: [NewsletterMetricScope, string];
  Id: string;
}>(newsletterMetricsComponent);

export type NewsletterAnalyticsCounts = Record<NewsletterMetricName, number>;

/** Mirror only fields the on-demand analytics panel actually counts. */
export async function recordNewsletterMetric(
  ctx: MutationCtx,
  args: {
    issueId: Id<"newsletterIssues"> | undefined;
    scope: NewsletterMetricScope;
    eventType: string;
    id: string;
  },
) {
  if (
    args.issueId === undefined ||
    !analyticsMetricKeys.has(`${args.scope}:${args.eventType}`)
  ) {
    return;
  }

  await newsletterMetrics.insertIfDoesNotExist(ctx, {
    namespace: args.issueId,
    key: [args.scope, args.eventType],
    id: `${args.scope}:${args.id}`,
    sumValue: 1,
  });
}

/** Read the exact pre-aggregated counters for up to the admin panel's 30 issues. */
export async function newsletterAnalyticsCounts(
  ctx: QueryCtx,
  issueIds: readonly Id<"newsletterIssues">[],
) {
  if (issueIds.length === 0)
    return new Map<string, NewsletterAnalyticsCounts>();

  const queries = issueIds.flatMap((issueId) =>
    newsletterMetricsList.map((metric) => ({
      namespace: issueId,
      bounds: {
        prefix: [metric.scope, metric.eventType] as [
          NewsletterMetricScope,
          string,
        ],
      },
    })),
  );
  const values = await newsletterMetrics.countBatch(ctx, queries);
  const byIssue = new Map<string, NewsletterAnalyticsCounts>();
  let valueIndex = 0;
  for (const issueId of issueIds) {
    const counts: NewsletterAnalyticsCounts = {
      delivered: 0,
      opened: 0,
      bounced: 0,
      complained: 0,
      archiveViews: 0,
      archiveClicks: 0,
      sourceClicks: 0,
      discussionClicks: 0,
      forumClicks: 0,
      newsIndexClicks: 0,
    };
    for (const metric of newsletterMetricsList) {
      counts[metric.name] = values[valueIndex] ?? 0;
      valueIndex += 1;
    }
    byIssue.set(String(issueId), counts);
  }
  return byIssue;
}
