"use node";
import { PRIMARY_SITE_URL } from "../lib/site-urls";


import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Markdown,
  Preview,
  Section,
  Text,
  render,
  toPlainText,
} from "react-email";
import { Resend as ResendSdk } from "resend";
import { makeFunctionReference } from "convex/server";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { resend } from "./resendClient";
import type { ReactElement, ReactNode } from "react";
import {
  parseEditorialNewsletterPayload,
  type EditorialNewsletterPayload,
} from "./newsletterPayload";

const SEGMENT_NAME = "SYMBaiEX Newsletter";
const WEEKLY_TOPIC_NAME = "Field Notes";
const DAILY_TOPIC_NAME = "Daily Signals";
const SEGMENT_SETTING = "resend.segmentId";
const WEEKLY_TOPIC_SETTING = "resend.topicId";
const DAILY_TOPIC_SETTING = "resend.dailyTopicId";
const RESEND_BROADCAST_NAME_MAX_LENGTH = 70;
const RESEND_REQUEST_INTERVAL_MS = 260;

type ResendPacer = () => Promise<void>;

const readSubscriberRef = makeFunctionReference<
  "query",
  { subscriberId: Id<"newsletterSubscribers"> },
  Doc<"newsletterSubscribers"> | null
>("newsletter:readSubscriber");

const listConfirmedSubscribersForResendSyncRef = makeFunctionReference<
  "query",
  { limit?: number },
  Doc<"newsletterSubscribers">[]
>("newsletter:listConfirmedSubscribersForResendSync");

const readIssueRef = makeFunctionReference<
  "query",
  { issueId: Id<"newsletterIssues"> },
  Doc<"newsletterIssues"> | null
>("newsletter:readIssue");

const getSettingRef = makeFunctionReference<
  "query",
  { key: string },
  string | null
>("newsletter:getSetting");

const setSettingRef = makeFunctionReference<
  "mutation",
  { key: string; value: string },
  null
>("newsletter:setSetting");

const markSubscriberResendStateRef = makeFunctionReference<
  "mutation",
  {
    subscriberId: Id<"newsletterSubscribers">;
    resendContactId?: string;
    resendSyncStatus: "idle" | "synced" | "failed" | "not_configured";
    resendError?: string;
  },
  null
>("newsletter:markSubscriberResendState");

const markIssueBroadcastRef = makeFunctionReference<
  "mutation",
  {
    issueId: Id<"newsletterIssues">;
    status: "sent" | "failed";
    resendBroadcastId?: string;
    errorMessage?: string;
  },
  null
>("newsletter:markIssueBroadcast");

type DailyNewsletterStory = {
  hnItemId: number;
  rank: number;
  title: string;
  host?: string;
  by?: string;
  score?: number;
  comments?: number;
  sourceUrl?: string;
  siteUrl: string;
  summary: string;
  theme: string;
  relevanceScore: number;
};

type DailyNewsletterPayload = {
  kind: "daily-news";
  version: 1;
  runDate: string;
  snapshotDate: string;
  generatedAt: number;
  siteUrl: string;
  newsUrl: string;
  intro: string;
  themeLabel: string;
  quote: {
    quoteKey: string;
    quote: string;
    author: string;
    source: string;
    sourceUrl?: string;
    reflection: string;
  };
  topStories: DailyNewsletterStory[];
  additionalStories: DailyNewsletterStory[];
};

export const sendConfirmationEmail = internalAction({
  args: {
    subscriberId: v.id("newsletterSubscribers"),
    token: v.string(),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isResendConfigured()) {
      await ctx.runMutation(markSubscriberResendStateRef, {
        subscriberId: args.subscriberId,
        resendSyncStatus: "not_configured",
        resendError: "RESEND_API_KEY is not configured",
      });
      return null;
    }

    const subscriber = await ctx.runQuery(readSubscriberRef, {
      subscriberId: args.subscriberId,
    });
    if (subscriber === null || subscriber.status === "unsubscribed") {
      return null;
    }

    const confirmUrl = `${args.siteUrl}/newsletter/confirm?token=${encodeURIComponent(args.token)}`;
    const unsubscribeUrl = `${args.siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(args.token)}`;
    const { html, text } = await renderEmail(
      <BaseEmail preview="Confirm your SYMBaiEX newsletter subscription.">
        <Heading style={styles.heading}>Confirm the signal</Heading>
        <Text style={styles.copy}>
          One click confirms that this inbox should receive SYMBaiEX notes,
          project dispatches, and compact field reports.
        </Text>
        <Button href={confirmUrl} style={styles.button}>
          Confirm subscription
        </Button>
        <Text style={styles.small}>
          If this was not you, ignore this email or{" "}
          <Link href={unsubscribeUrl} style={styles.link}>
            unsubscribe
          </Link>
          .
        </Text>
      </BaseEmail>,
    );

    await resend.sendEmail(ctx, {
      from: fromEmail(),
      to: subscriber.email,
      subject: "Confirm SYMBaiEX newsletter",
      html,
      text,
      replyTo: replyToEmails(),
    });
    return null;
  },
});

export const sendManageSubscriptionEmail = internalAction({
  args: {
    subscriberId: v.id("newsletterSubscribers"),
    token: v.string(),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isResendConfigured()) {
      return null;
    }

    const subscriber = await ctx.runQuery(readSubscriberRef, {
      subscriberId: args.subscriberId,
    });
    if (subscriber === null || subscriber.status !== "confirmed") {
      return null;
    }

    const unsubscribeUrl = `${args.siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(args.token)}`;
    const preferencesUrl = `${args.siteUrl}/newsletter/preferences?token=${encodeURIComponent(args.token)}`;
    const { html, text } = await renderEmail(
      <BaseEmail preview="Manage your SYMBaiEX newsletter subscription.">
        <Heading style={styles.heading}>Manage your subscription</Heading>
        <Text style={styles.copy}>
          This inbox is already confirmed for SYMBaiEX notes. Choose daily
          signals, weekly field notes, or both from the preferences link. The
          button below stops every newsletter.
        </Text>
        <Button href={unsubscribeUrl} style={styles.button}>
          Unsubscribe
        </Button>
        <Text style={styles.small}>
          Manage newsletter preferences at{" "}
          <Link href={preferencesUrl} style={styles.link}>
            {new URL(PRIMARY_SITE_URL).hostname}/newsletter/preferences
          </Link>
          .
        </Text>
      </BaseEmail>,
    );

    await resend.sendEmail(ctx, {
      from: fromEmail(),
      to: subscriber.email,
      subject: "Manage your SYMBaiEX newsletter",
      html,
      text,
      replyTo: replyToEmails(),
    });
    return null;
  },
});

export const sendWelcomeEmail = internalAction({
  args: {
    subscriberId: v.id("newsletterSubscribers"),
    siteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isResendConfigured()) {
      return null;
    }
    const subscriber = await ctx.runQuery(readSubscriberRef, {
      subscriberId: args.subscriberId,
    });
    if (subscriber === null || subscriber.status !== "confirmed") {
      return null;
    }

    const { html, text } = await renderEmail(
      <BaseEmail preview="You are on the SYMBaiEX newsletter list.">
        <Heading style={styles.heading}>You are in</Heading>
        <Text style={styles.copy}>
          Thanks for subscribing. Belle&apos;s daily signal connects a small
          source set into one useful argument; the weekly field note goes
          deeper. Both stay source-linked, practical, and open to discussion.
        </Text>
        <Button href={`${args.siteUrl}/newsletter`} style={styles.button}>
          Open the newsletter archive
        </Button>
      </BaseEmail>,
    );

    await resend.sendEmail(ctx, {
      from: fromEmail(),
      to: subscriber.email,
      subject: "Welcome to SYMBaiEX",
      html,
      text,
      replyTo: replyToEmails(),
    });
    return null;
  },
});

export const syncSubscriberToResend = internalAction({
  args: { subscriberId: v.id("newsletterSubscribers") },
  handler: async (ctx, args) => {
    if (!isResendConfigured()) {
      await ctx.runMutation(markSubscriberResendStateRef, {
        subscriberId: args.subscriberId,
        resendSyncStatus: "not_configured",
        resendError: "RESEND_API_KEY is not configured",
      });
      return null;
    }

    const subscriber = await ctx.runQuery(readSubscriberRef, {
      subscriberId: args.subscriberId,
    });
    if (subscriber === null || subscriber.status === "pending") {
      return null;
    }

    try {
      const client = resendSdk();
      const pacer = createResendPacer();
      const { segmentId, dailyTopicId, weeklyTopicId } =
        await ensureResendListSettings(ctx, client, pacer);
      await syncSubscriberRecordToResend(
        ctx,
        client,
        subscriber,
        segmentId,
        dailyTopicId,
        weeklyTopicId,
        pacer,
      );
    } catch (error) {
      await ctx.runMutation(markSubscriberResendStateRef, {
        subscriberId: args.subscriberId,
        resendSyncStatus: "failed",
        resendError: errorMessage(error),
      });
    }
    return null;
  },
});

export const sendNewsletterIssueTest = internalAction({
  args: {
    issueId: v.id("newsletterIssues"),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isResendConfigured()) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    const issue = await ctx.runQuery(readIssueRef, { issueId: args.issueId });
    if (issue === null) {
      throw new Error("Newsletter issue not found");
    }
    const { html, text } = await renderIssueEmail(issue, testUnsubscribeUrl());
    await resend.sendEmail(ctx, {
      from: fromEmail(),
      to: args.to,
      subject: `[Test] ${issue.subject}`,
      html,
      text,
      replyTo: replyToEmails(),
    });
    return null;
  },
});

export const sendNewsletterIssue = internalAction({
  args: { issueId: v.id("newsletterIssues") },
  handler: async (ctx, args) => {
    const issue = await ctx.runQuery(readIssueRef, { issueId: args.issueId });
    if (
      issue === null ||
      issue.status === "sent" ||
      issue.status === "cancelled"
    ) {
      return null;
    }
    if (!isResendConfigured()) {
      await ctx.runMutation(markIssueBroadcastRef, {
        issueId: args.issueId,
        status: "failed",
        errorMessage: "RESEND_API_KEY is not configured",
      });
      return null;
    }

    try {
      const client = resendSdk();
      const pacer = createResendPacer();
      const { segmentId, dailyTopicId, weeklyTopicId } =
        await ensureResendListSettings(ctx, client, pacer);
      const audience = await syncConfirmedAudienceForBroadcast(
        ctx,
        client,
        segmentId,
        dailyTopicId,
        weeklyTopicId,
        pacer,
      );
      if (audience.confirmed === 0) {
        throw new Error(
          "No confirmed newsletter subscribers. Confirm at least one subscriber before sending a broadcast.",
        );
      }
      if (audience.synced === 0) {
        throw new Error(
          `No confirmed subscribers could be synced to Resend (${audience.failed} failed).`,
        );
      }
      const unsubscribeUrl = "{{{RESEND_UNSUBSCRIBE_URL}}}";
      const { html, text } = await renderIssueEmail(issue, unsubscribeUrl);
      const response = await callResend(pacer, () =>
        client.broadcasts.create({
          name: resendBroadcastName(issue),
          from: fromEmail(),
          replyTo: replyToEmails(),
          subject: issue.subject,
          previewText: issue.previewText,
          html,
          text,
          segmentId,
          topicId:
            issue.edition === "weekly-field-note"
              ? weeklyTopicId
              : dailyTopicId,
          send: true,
        }),
      );
      if (response.error) {
        throw new Error(response.error.message);
      }
      await ctx.runMutation(markIssueBroadcastRef, {
        issueId: issue._id,
        status: "sent",
        resendBroadcastId: response.data.id,
      });
    } catch (error) {
      await ctx.runMutation(markIssueBroadcastRef, {
        issueId: args.issueId,
        status: "failed",
        errorMessage: errorMessage(error),
      });
    }
    return null;
  },
});

async function syncConfirmedAudienceForBroadcast(
  ctx: ActionCtx,
  client: ResendSdk,
  segmentId: string,
  dailyTopicId: string,
  weeklyTopicId: string,
  pacer: ResendPacer,
) {
  const subscribers = await ctx.runQuery(
    listConfirmedSubscribersForResendSyncRef,
    {
      limit: 100,
    },
  );
  let synced = 0;
  let failed = 0;

  for (const subscriber of subscribers) {
    try {
      await syncSubscriberRecordToResend(
        ctx,
        client,
        subscriber,
        segmentId,
        dailyTopicId,
        weeklyTopicId,
        pacer,
      );
      synced += 1;
    } catch (error) {
      await ctx.runMutation(markSubscriberResendStateRef, {
        subscriberId: subscriber._id,
        resendSyncStatus: "failed",
        resendError: errorMessage(error),
      });
      failed += 1;
    }
  }

  return { confirmed: subscribers.length, synced, failed };
}

async function syncSubscriberRecordToResend(
  ctx: ActionCtx,
  client: ResendSdk,
  subscriber: Doc<"newsletterSubscribers">,
  segmentId: string,
  dailyTopicId: string,
  weeklyTopicId: string,
  pacer: ResendPacer,
) {
  const unsubscribed = subscriber.status !== "confirmed";
  const dailySubscription =
    unsubscribed || subscriber.dailyOptIn === false ? "opt_out" : "opt_in";
  const weeklySubscription =
    unsubscribed || subscriber.weeklyOptIn === false ? "opt_out" : "opt_in";
  let contactId = subscriber.resendContactId;

  if (!contactId) {
    const existing = await callResend(pacer, () =>
      client.contacts.get({ email: subscriber.email }),
    );
    if (existing.data) {
      contactId = existing.data.id;
    } else if (existing.error && existing.error.name !== "not_found") {
      throw new Error(existing.error.message);
    }
  }

  const resolvedContactId = contactId;

  if (resolvedContactId) {
    const updated = await callResend(pacer, () =>
      client.contacts.update({
        id: resolvedContactId,
        unsubscribed,
      }),
    );
    if (updated.error) {
      throw new Error(updated.error.message);
    }

    const segment = await callResend(pacer, () =>
      client.contacts.segments.add({
        contactId: resolvedContactId,
        segmentId,
      }),
    );
    if (segment.error && segment.error.name !== "validation_error") {
      throw new Error(segment.error.message);
    }

    const topic = await callResend(pacer, () =>
      client.contacts.topics.update({
        id: resolvedContactId,
        topics: [
          { id: dailyTopicId, subscription: dailySubscription },
          { id: weeklyTopicId, subscription: weeklySubscription },
        ],
      }),
    );
    if (topic.error) {
      throw new Error(topic.error.message);
    }
  } else {
    const created = await callResend(pacer, () =>
      client.contacts.create({
        email: subscriber.email,
        unsubscribed,
        segments: [{ id: segmentId }],
        topics: [
          { id: dailyTopicId, subscription: dailySubscription },
          { id: weeklyTopicId, subscription: weeklySubscription },
        ],
      }),
    );
    if (created.error) {
      throw new Error(created.error.message);
    }
    contactId = created.data.id;
  }

  await ctx.runMutation(markSubscriberResendStateRef, {
    subscriberId: subscriber._id,
    resendContactId: contactId,
    resendSyncStatus: "synced",
  });
}

async function ensureResendListSettings(
  ctx: ActionCtx,
  client: ResendSdk,
  pacer: ResendPacer,
) {
  const segmentId = await ensureSegment(ctx, client, pacer);
  const dailyTopicId = await ensureTopic(ctx, client, pacer, {
    description: "Belle's reviewed daily source-led technology signal.",
    name: DAILY_TOPIC_NAME,
    settingKey: DAILY_TOPIC_SETTING,
  });
  const weeklyTopicId = await ensureTopic(ctx, client, pacer, {
    description: "Long-form weekly SYMBaiEX research and field notes.",
    name: WEEKLY_TOPIC_NAME,
    settingKey: WEEKLY_TOPIC_SETTING,
  });
  return { segmentId, dailyTopicId, weeklyTopicId };
}

async function ensureSegment(
  ctx: ActionCtx,
  client: ResendSdk,
  pacer: ResendPacer,
) {
  const existingId = await ctx.runQuery(getSettingRef, {
    key: SEGMENT_SETTING,
  });
  if (existingId) {
    return existingId;
  }
  const list = await callResend(pacer, () =>
    client.segments.list({ limit: 100 }),
  );
  if (list.error) {
    throw new Error(list.error.message);
  }
  const found = list.data.data.find((segment) => segment.name === SEGMENT_NAME);
  if (found) {
    await ctx.runMutation(setSettingRef, {
      key: SEGMENT_SETTING,
      value: found.id,
    });
    return found.id;
  }
  const created = await callResend(pacer, () =>
    client.segments.create({ name: SEGMENT_NAME }),
  );
  if (created.error) {
    throw new Error(created.error.message);
  }
  await ctx.runMutation(setSettingRef, {
    key: SEGMENT_SETTING,
    value: created.data.id,
  });
  return created.data.id;
}

async function ensureTopic(
  ctx: ActionCtx,
  client: ResendSdk,
  pacer: ResendPacer,
  topic: {
    description: string;
    name: string;
    settingKey: string;
  },
) {
  const existingId = await ctx.runQuery(getSettingRef, {
    key: topic.settingKey,
  });
  if (existingId) {
    return existingId;
  }
  const list = await callResend(pacer, () => client.topics.list());
  if (list.error) {
    throw new Error(list.error.message);
  }
  const found = list.data.data.find((row) => row.name === topic.name);
  if (found) {
    await ctx.runMutation(setSettingRef, {
      key: topic.settingKey,
      value: found.id,
    });
    return found.id;
  }
  const created = await callResend(pacer, () =>
    client.topics.create({
      name: topic.name,
      description: topic.description,
      defaultSubscription: "opt_in",
    }),
  );
  if (created.error) {
    throw new Error(created.error.message);
  }
  await ctx.runMutation(setSettingRef, {
    key: topic.settingKey,
    value: created.data.id,
  });
  return created.data.id;
}

async function renderIssueEmail(
  issue: Doc<"newsletterIssues">,
  unsubscribeUrl: string,
) {
  const editorialPayload = parseEditorialNewsletterPayload(issue.body);
  if (editorialPayload) {
    return await renderEditorialNewsletterEmail(
      issue,
      editorialPayload,
      unsubscribeUrl,
    );
  }
  const dailyPayload = parseDailyNewsletterPayload(issue.body);
  if (dailyPayload) {
    return await renderDailyNewsletterEmail(
      issue,
      dailyPayload,
      unsubscribeUrl,
    );
  }

  return await renderEmail(
    <BaseEmail preview={issue.previewText}>
      <Heading style={styles.heading}>{issue.subject}</Heading>
      <Text style={styles.copy}>{issue.previewText}</Text>
      <Hr style={styles.hr} />
      <Markdown
        markdownContainerStyles={{
          color: styles.body.color,
          fontSize: styles.body.fontSize,
          lineHeight: styles.body.lineHeight,
          margin: styles.body.margin,
        }}
      >
        {issue.body}
      </Markdown>
      <Hr style={styles.hr} />
      <Text style={styles.small}>
        Manage newsletter preferences or unsubscribe at{" "}
        <Link href={unsubscribeUrl} style={styles.link}>
          {new URL(PRIMARY_SITE_URL).hostname}/newsletter/preferences
        </Link>
        .
      </Text>
    </BaseEmail>,
  );
}

async function renderEditorialNewsletterEmail(
  issue: Doc<"newsletterIssues">,
  payload: EditorialNewsletterPayload,
  unsubscribeUrl: string,
) {
  const dateLabel = formatRunDate(payload.runDate);
  const editionLabel =
    payload.edition === "weekly-field-note"
      ? "Weekly field note"
      : "Belle's daily signal";
  const track = (target: string) =>
    `${payload.siteUrl}/newsletter/${issue.slug}/go/${target}`;
  return await renderEmail(
    <BaseEmail preview={issue.previewText}>
      <Section style={styles.accentRule}>
        <Text style={styles.accentMagenta}> </Text>
        <Text style={styles.accentCyan}> </Text>
        <Text style={styles.accentYellow}> </Text>
      </Section>
      <Text style={styles.eyebrow}>
        {editionLabel} / {dateLabel}
      </Text>
      <Heading style={styles.heading}>{payload.headline}</Heading>
      <Text style={styles.dek}>{payload.dek}</Text>
      <Text style={styles.byline}>
        By Belle / {payload.author.role} / AI-assisted, source-linked
      </Text>
      {payload.heroImage ? (
        <Section style={styles.heroWrap}>
          <Img
            alt={payload.heroImage.alt}
            src={payload.heroImage.url}
            style={styles.heroImage}
          />
          {payload.heroImage.credit ? (
            <Text style={styles.imageCredit}>
              Image: {payload.heroImage.credit}
            </Text>
          ) : null}
        </Section>
      ) : null}
      <Section style={styles.thesisBlock}>
        <Text style={styles.sectionLabel}>The thread through today</Text>
        <Text style={styles.thesis}>{payload.thesis}</Text>
      </Section>
      <Text style={styles.copy}>{payload.lead}</Text>
      {payload.sections?.map((section) => (
        <Section key={section.heading} style={styles.editorialSection}>
          <Heading as="h2" style={styles.sectionHeading}>
            {section.heading}
          </Heading>
          <Text style={styles.copy}>{section.body}</Text>
        </Section>
      ))}
      <Hr style={styles.hr} />
      <Text style={styles.sectionLabel}>{payload.chart.title}</Text>
      <Text style={styles.chartSubtitle}>{payload.chart.subtitle}</Text>
      <Section style={styles.chartBlock}>
        {payload.chart.items.map((item) => (
          <Section key={item.label} style={styles.chartRow}>
            <Text style={styles.chartLabel}>
              {item.label} / {item.value}
            </Text>
            <Section style={styles.chartTrack}>
              <Section
                style={{
                  ...styles.chartFill,
                  width: `${Math.max(2, item.value)}%`,
                }}
              />
            </Section>
            <Text style={styles.chartNote}>{item.note}</Text>
          </Section>
        ))}
      </Section>
      <Text style={styles.chartMetric}>{payload.chart.metricLabel}</Text>
      <Hr style={styles.hr} />
      <Text style={styles.sectionLabel}>Source-led briefing</Text>
      {payload.stories.map((story, index) => (
        <Section key={story.hnItemId} style={styles.storyFeature}>
          <Text style={styles.storyMeta}>
            #{String(index + 1).padStart(2, "0")} / signal {story.signalScore}
            {story.host ? ` / ${story.host}` : ""}
          </Text>
          <Heading as="h3" style={styles.storyHeading}>
            {story.title}
          </Heading>
          <Text style={styles.storySummary}>{story.summary}</Text>
          <Text style={styles.storyWhy}>
            <strong>Why it matters:</strong> {story.whyItMatters}
          </Text>
          <Section style={styles.takeawayBlock}>
            {story.takeaways.map((takeaway) => (
              <Text key={takeaway} style={styles.takeaway}>
                • {takeaway}
              </Text>
            ))}
          </Section>
          <Button
            href={track(`source-${story.hnItemId}`)}
            style={styles.smallButton}
          >
            Read source
          </Button>{" "}
          <Link
            href={track(`discussion-${story.hnItemId}`)}
            style={styles.inlineLink}
          >
            HN discussion
          </Link>
        </Section>
      ))}
      <Hr style={styles.hr} />
      <Text style={styles.sectionLabel}>What to do with this</Text>
      {payload.practicalMoves.map((move) => (
        <Text key={move} style={styles.listItem}>
          • {move}
        </Text>
      ))}
      <Text style={styles.sectionLabel}>What Belle is watching</Text>
      {payload.whatToWatch.map((item) => (
        <Text key={item} style={styles.listItem}>
          • {item}
        </Text>
      ))}
      <Section style={styles.discussionBlock}>
        <Text style={styles.sectionLabel}>Join the argument</Text>
        <Text style={styles.discussionQuestion}>
          {payload.discussion.question}
        </Text>
        {payload.discussion.forumUrl ? (
          <Button href={track("forum")} style={styles.button}>
            Discuss on the forum
          </Button>
        ) : null}
      </Section>
      <Button href={track("archive")} style={styles.archiveButton}>
        Read and share this edition
      </Button>
      <Text style={styles.methodology}>{payload.methodology}</Text>
      <Text style={styles.disclosure}>{payload.author.disclosure}</Text>
      <Hr style={styles.hr} />
      <Text style={styles.small}>
        Manage newsletter preferences or unsubscribe at{" "}
        <Link href={unsubscribeUrl} style={styles.link}>
          {new URL(PRIMARY_SITE_URL).hostname}/newsletter/preferences
        </Link>
        .
      </Text>
    </BaseEmail>,
  );
}

async function renderDailyNewsletterEmail(
  issue: Doc<"newsletterIssues">,
  payload: DailyNewsletterPayload,
  unsubscribeUrl: string,
) {
  const dateLabel = formatRunDate(payload.runDate);
  return await renderEmail(
    <BaseEmail preview={issue.previewText}>
      <Section style={styles.accentRule}>
        <Text style={styles.accentMagenta}> </Text>
        <Text style={styles.accentCyan}> </Text>
        <Text style={styles.accentYellow}> </Text>
      </Section>
      <Text style={styles.eyebrow}>Daily signal / {dateLabel}</Text>
      <Heading style={styles.heading}>The Morning Signal</Heading>
      <Text style={styles.copy}>{payload.intro}</Text>
      <Section style={styles.quoteBlock}>
        <Text style={styles.quoteMark}>
          {"("}signal{")"}
        </Text>
        <Text style={styles.quoteText}>
          &ldquo;{payload.quote.quote}&rdquo;
        </Text>
        <Text style={styles.quoteAuthor}>
          - {payload.quote.author} / {payload.quote.source}
        </Text>
        <Text style={styles.quoteReflection}>{payload.quote.reflection}</Text>
      </Section>
      <Button href={payload.newsUrl} style={styles.button}>
        Open today&apos;s index
      </Button>
      <Hr style={styles.hr} />
      <Text style={styles.sectionLabel}>Top 3</Text>
      {payload.topStories.map((story, index) => (
        <Section key={story.hnItemId} style={styles.storyFeature}>
          <Text style={styles.storyMeta}>
            #{String(index + 1).padStart(2, "0")} / {story.theme}
            {story.host ? ` / ${story.host}` : ""}
            {story.by ? ` / by ${story.by}` : ""}
          </Text>
          <Link href={story.siteUrl} style={styles.storyTitle}>
            {story.title}
          </Link>
          <Text style={styles.storySummary}>{story.summary}</Text>
          <Button href={story.siteUrl} style={styles.smallButton}>
            Read on SYMBaiEX
          </Button>
        </Section>
      ))}
      {payload.additionalStories.length > 0 && (
        <>
          <Hr style={styles.hr} />
          <Text style={styles.sectionLabel}>
            {payload.additionalStories.length} more worth opening
          </Text>
          {payload.additionalStories.map((story) => (
            <Section key={story.hnItemId} style={styles.storyCompact}>
              <Link href={story.siteUrl} style={styles.compactTitle}>
                {story.title}
              </Link>
              <Text style={styles.compactMeta}>
                {story.host ?? "news.ycombinator.com"}
                {story.by ? ` / by ${story.by}` : ""}
                {typeof story.comments === "number"
                  ? ` / ${story.comments} HN comments`
                  : ""}
              </Text>
            </Section>
          ))}
        </>
      )}
      <Hr style={styles.hr} />
      <Text style={styles.small}>
        This email links to the SYMBaiEX index first so you can read the source,
        save stories, and join the thread. Manage preferences or unsubscribe at{" "}
        <Link href={unsubscribeUrl} style={styles.link}>
          {new URL(PRIMARY_SITE_URL).hostname}/newsletter/preferences
        </Link>
        .
      </Text>
    </BaseEmail>,
  );
}

function parseDailyNewsletterPayload(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<DailyNewsletterPayload>;
    if (
      parsed.kind !== "daily-news" ||
      parsed.version !== 1 ||
      typeof parsed.runDate !== "string" ||
      typeof parsed.newsUrl !== "string" ||
      typeof parsed.intro !== "string" ||
      !parsed.quote ||
      !Array.isArray(parsed.topStories) ||
      !Array.isArray(parsed.additionalStories)
    ) {
      return null;
    }
    return parsed as DailyNewsletterPayload;
  } catch {
    return null;
  }
}

function formatRunDate(runDate: string) {
  const date = new Date(`${runDate}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function renderEmail(children: ReactElement) {
  const html = await render(children);
  return { html, text: toPlainText(html) };
}

function BaseEmail({
  children,
  preview,
}: {
  children: ReactNode;
  preview: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.page}>
        <Container style={styles.container}>
          <Link href={PRIMARY_SITE_URL} style={styles.brand}>
            SYMBaiEX
          </Link>
          <Section>{children}</Section>
          <Text style={styles.footer}>
            Software, AI systems, and design notes.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function resendSdk() {
  return new ResendSdk(env.RESEND_API_KEY);
}

function isResendConfigured() {
  return Boolean(env.RESEND_API_KEY);
}

function fromEmail() {
  return env.NEWSLETTER_FROM_EMAIL || "SYMBaiEX <onboarding@resend.dev>";
}

function replyToEmails() {
  const value = env.NEWSLETTER_REPLY_TO;
  return value ? [value] : undefined;
}

function testUnsubscribeUrl() {
  const siteUrl = env.NEWSLETTER_SITE_URL || PRIMARY_SITE_URL;
  return `${siteUrl}/newsletter/preferences`;
}

function createResendPacer(intervalMs = RESEND_REQUEST_INTERVAL_MS) {
  let nextRequestAt = 0;
  return async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextRequestAt - now);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextRequestAt = Date.now() + intervalMs;
  };
}

async function callResend<Result>(
  pacer: ResendPacer,
  request: () => Promise<Result>,
) {
  await pacer();
  return await request();
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resendBroadcastName(
  issue: Pick<Doc<"newsletterIssues">, "slug" | "subject">,
) {
  return (
    limitPlainText(issue.subject, RESEND_BROADCAST_NAME_MAX_LENGTH) ||
    limitPlainText(issue.slug, RESEND_BROADCAST_NAME_MAX_LENGTH) ||
    "SYMBaiEX newsletter"
  );
}

function limitPlainText(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }

  const suffix = "...";
  return `${clean.slice(0, maxLength - suffix.length).trimEnd()}${suffix}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "Unknown error";
}

const styles = {
  page: {
    margin: 0,
    backgroundColor: "#080808",
    color: "#f5f5f5",
    fontFamily:
      'Geist, "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  container: {
    width: "100%",
    maxWidth: "640px",
    margin: "0 auto",
    padding: "40px 22px",
  },
  brand: {
    margin: "0 0 28px",
    color: "#ffffff",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  accentRule: {
    display: "flex",
    width: "100%",
    margin: "0 0 30px",
  },
  accentMagenta: {
    display: "inline-block",
    width: "34%",
    height: "4px",
    margin: "0",
    backgroundColor: "#ff35c8",
    lineHeight: "4px",
  },
  accentCyan: {
    display: "inline-block",
    width: "33%",
    height: "4px",
    margin: "0",
    backgroundColor: "#8de7df",
    lineHeight: "4px",
  },
  accentYellow: {
    display: "inline-block",
    width: "33%",
    height: "4px",
    margin: "0",
    backgroundColor: "#ffe95f",
    lineHeight: "4px",
  },
  eyebrow: {
    margin: "0 0 12px",
    color: "#9b9b9b",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  heading: {
    margin: "0 0 18px",
    color: "#ffffff",
    fontSize: "34px",
    lineHeight: "1",
    fontWeight: 750,
  },
  dek: {
    margin: "0 0 12px",
    color: "#d7d7d7",
    fontSize: "19px",
    lineHeight: "1.5",
  },
  byline: {
    margin: "0 0 24px",
    color: "#8f8f8f",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "11px",
    lineHeight: "1.5",
    textTransform: "uppercase" as const,
  },
  heroWrap: {
    margin: "0 0 26px",
  },
  heroImage: {
    display: "block",
    width: "100%",
    height: "auto",
    maxHeight: "360px",
    objectFit: "cover" as const,
    border: "1px solid #2b2b2b",
  },
  imageCredit: {
    margin: "7px 0 0",
    color: "#777777",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "10px",
    lineHeight: "1.4",
  },
  thesisBlock: {
    margin: "0 0 24px",
    padding: "18px",
    borderLeft: "3px solid #ffe95f",
    backgroundColor: "#111111",
  },
  thesis: {
    margin: "0",
    color: "#f1f1f1",
    fontSize: "18px",
    lineHeight: "1.55",
    fontWeight: 650,
  },
  editorialSection: {
    margin: "0 0 26px",
  },
  sectionHeading: {
    margin: "0 0 10px",
    color: "#ffffff",
    fontSize: "24px",
    lineHeight: "1.2",
  },
  copy: {
    margin: "0 0 22px",
    color: "#c8c8c8",
    fontSize: "16px",
    lineHeight: "1.65",
  },
  body: {
    margin: "22px 0",
    color: "#e8e8e8",
    fontSize: "16px",
    lineHeight: "1.7",
    whiteSpace: "pre-wrap" as const,
  },
  quoteBlock: {
    margin: "26px 0",
    padding: "22px 0",
    borderTop: "1px solid #2b2b2b",
    borderBottom: "1px solid #2b2b2b",
  },
  quoteMark: {
    margin: "0 0 12px",
    color: "#ff35c8",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  quoteText: {
    margin: "0",
    color: "#ffffff",
    fontSize: "22px",
    lineHeight: "1.35",
    fontWeight: 650,
  },
  quoteAuthor: {
    margin: "12px 0 0",
    color: "#a7a7a7",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "12px",
    lineHeight: "1.5",
    textTransform: "uppercase" as const,
  },
  quoteReflection: {
    margin: "16px 0 0",
    color: "#c8c8c8",
    fontSize: "15px",
    lineHeight: "1.65",
  },
  sectionLabel: {
    margin: "0 0 16px",
    color: "#8de7df",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  storyFeature: {
    margin: "0 0 28px",
    padding: "0",
  },
  storyMeta: {
    margin: "0 0 8px",
    color: "#9b9b9b",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "12px",
    lineHeight: "1.5",
    textTransform: "uppercase" as const,
  },
  storyTitle: {
    display: "block",
    margin: "0",
    color: "#ffffff",
    fontSize: "22px",
    lineHeight: "1.25",
    fontWeight: 750,
    textDecoration: "none",
  },
  storySummary: {
    margin: "10px 0 14px",
    color: "#bdbdbd",
    fontSize: "15px",
    lineHeight: "1.6",
  },
  storyHeading: {
    margin: "0",
    color: "#ffffff",
    fontSize: "22px",
    lineHeight: "1.3",
    fontWeight: 750,
  },
  storyWhy: {
    margin: "0 0 12px",
    color: "#dedede",
    fontSize: "15px",
    lineHeight: "1.6",
  },
  takeawayBlock: {
    margin: "0 0 14px",
    padding: "12px 14px",
    backgroundColor: "#101010",
    border: "1px solid #292929",
  },
  takeaway: {
    margin: "0 0 6px",
    color: "#c9c9c9",
    fontSize: "14px",
    lineHeight: "1.55",
  },
  inlineLink: {
    marginLeft: "12px",
    color: "#8de7df",
    fontSize: "12px",
    fontWeight: 700,
    textDecoration: "underline",
  },
  chartSubtitle: {
    margin: "-8px 0 18px",
    color: "#a7a7a7",
    fontSize: "14px",
    lineHeight: "1.55",
  },
  chartBlock: {
    margin: "0 0 10px",
    padding: "16px",
    backgroundColor: "#101010",
    border: "1px solid #2b2b2b",
  },
  chartRow: {
    margin: "0 0 16px",
  },
  chartLabel: {
    margin: "0 0 6px",
    color: "#f1f1f1",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },
  chartTrack: {
    width: "100%",
    height: "8px",
    backgroundColor: "#272727",
  },
  chartFill: {
    height: "8px",
    backgroundColor: "#ff35c8",
  },
  chartNote: {
    margin: "6px 0 0",
    color: "#9f9f9f",
    fontSize: "12px",
    lineHeight: "1.45",
  },
  chartMetric: {
    margin: "8px 0 0",
    color: "#777777",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "10px",
    textTransform: "uppercase" as const,
  },
  listItem: {
    margin: "0 0 10px",
    color: "#c8c8c8",
    fontSize: "15px",
    lineHeight: "1.6",
  },
  discussionBlock: {
    margin: "28px 0 20px",
    padding: "20px",
    border: "1px solid #3a3a3a",
    backgroundColor: "#101010",
  },
  discussionQuestion: {
    margin: "0 0 18px",
    color: "#ffffff",
    fontSize: "19px",
    lineHeight: "1.5",
    fontWeight: 650,
  },
  archiveButton: {
    display: "inline-block",
    margin: "0 0 20px",
    backgroundColor: "#ffe95f",
    color: "#080808",
    padding: "13px 18px",
    borderRadius: "0",
    fontSize: "14px",
    fontWeight: 750,
    textDecoration: "none",
  },
  methodology: {
    margin: "8px 0 0",
    color: "#898989",
    fontSize: "12px",
    lineHeight: "1.55",
  },
  disclosure: {
    margin: "8px 0 0",
    color: "#777777",
    fontSize: "11px",
    lineHeight: "1.5",
  },
  smallButton: {
    display: "inline-block",
    backgroundColor: "transparent",
    color: "#ffffff",
    padding: "10px 13px",
    border: "1px solid #3a3a3a",
    borderRadius: "0",
    fontSize: "12px",
    fontWeight: 700,
    textDecoration: "none",
  },
  storyCompact: {
    margin: "0 0 16px",
  },
  compactTitle: {
    display: "block",
    color: "#ffffff",
    fontSize: "16px",
    lineHeight: "1.35",
    fontWeight: 700,
    textDecoration: "none",
  },
  compactMeta: {
    margin: "5px 0 0",
    color: "#8f8f8f",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "11px",
    lineHeight: "1.5",
    textTransform: "uppercase" as const,
  },
  button: {
    display: "inline-block",
    backgroundColor: "#ff35c8",
    color: "#ffffff",
    padding: "13px 18px",
    borderRadius: "0",
    fontSize: "14px",
    fontWeight: 700,
    textDecoration: "none",
  },
  small: {
    margin: "22px 0 0",
    color: "#a5a5a5",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  link: {
    color: "#8de7df",
    textDecoration: "underline",
  },
  hr: {
    borderColor: "#2b2b2b",
    margin: "24px 0",
  },
  footer: {
    margin: "34px 0 0",
    color: "#777777",
    fontSize: "12px",
    lineHeight: "1.5",
  },
};
