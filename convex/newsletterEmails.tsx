"use node";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
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
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { resend } from "./resendClient";
import type { ReactElement, ReactNode } from "react";

const SEGMENT_NAME = "SYMBaiEX Newsletter";
const TOPIC_NAME = "Field Notes";
const SEGMENT_SETTING = "resend.segmentId";
const TOPIC_SETTING = "resend.topicId";
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
    const preferencesUrl = `${args.siteUrl}/newsletter/preferences`;
    const { html, text } = await renderEmail(
      <BaseEmail preview="Manage your SYMBaiEX newsletter subscription.">
        <Heading style={styles.heading}>Manage your subscription</Heading>
        <Text style={styles.copy}>
          This inbox is already confirmed for SYMBaiEX notes. Use the button
          below to unsubscribe instantly, or ignore this email to keep
          receiving issues.
        </Text>
        <Button href={unsubscribeUrl} style={styles.button}>
          Unsubscribe
        </Button>
        <Text style={styles.small}>
          Manage newsletter preferences at{" "}
          <Link href={preferencesUrl} style={styles.link}>
            symbaiex.com/newsletter/preferences
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
          Thanks for subscribing. The newsletter will stay compact: essays,
          systems notes, agent research, and the occasional useful shard from
          the edge of the web.
        </Text>
        <Button href={`${args.siteUrl}/blog`} style={styles.button}>
          Read the archive
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
      const { segmentId, topicId } = await ensureResendListSettings(
        ctx,
        client,
        pacer,
      );
      await syncSubscriberRecordToResend(
        ctx,
        client,
        subscriber,
        segmentId,
        topicId,
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
      const { segmentId, topicId } = await ensureResendListSettings(
        ctx,
        client,
        pacer,
      );
      const audience = await syncConfirmedAudienceForBroadcast(
        ctx,
        client,
        segmentId,
        topicId,
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
      const siteUrl = process.env.NEWSLETTER_SITE_URL || "https://symbaiex.com";
      const unsubscribeUrl = `${siteUrl}/newsletter/preferences`;
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
          topicId,
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
  topicId: string,
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
        topicId,
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
  topicId: string,
  pacer: ResendPacer,
) {
  const unsubscribed = subscriber.status !== "confirmed";
  const topicSubscription = unsubscribed ? "opt_out" : "opt_in";
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
        topics: [{ id: topicId, subscription: topicSubscription }],
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
        topics: [{ id: topicId, subscription: topicSubscription }],
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
  const topicId = await ensureTopic(ctx, client, pacer);
  return { segmentId, topicId };
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
) {
  const existingId = await ctx.runQuery(getSettingRef, { key: TOPIC_SETTING });
  if (existingId) {
    return existingId;
  }
  const list = await callResend(pacer, () => client.topics.list());
  if (list.error) {
    throw new Error(list.error.message);
  }
  const found = list.data.data.find((topic) => topic.name === TOPIC_NAME);
  if (found) {
    await ctx.runMutation(setSettingRef, {
      key: TOPIC_SETTING,
      value: found.id,
    });
    return found.id;
  }
  const created = await callResend(pacer, () =>
    client.topics.create({
      name: TOPIC_NAME,
      description: "SYMBaiEX essays, project notes, and news digests.",
      defaultSubscription: "opt_in",
    }),
  );
  if (created.error) {
    throw new Error(created.error.message);
  }
  await ctx.runMutation(setSettingRef, {
    key: TOPIC_SETTING,
    value: created.data.id,
  });
  return created.data.id;
}

async function renderIssueEmail(
  issue: Doc<"newsletterIssues">,
  unsubscribeUrl: string,
) {
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
          symbaiex.com/newsletter/preferences
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
          symbaiex.com/newsletter/preferences
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
          <Link href="https://symbaiex.com" style={styles.brand}>
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
  return new ResendSdk(process.env.RESEND_API_KEY);
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromEmail() {
  return (
    process.env.NEWSLETTER_FROM_EMAIL || "SYMBaiEX <onboarding@resend.dev>"
  );
}

function replyToEmails() {
  const value = process.env.NEWSLETTER_REPLY_TO;
  return value ? [value] : undefined;
}

function testUnsubscribeUrl() {
  const siteUrl = process.env.NEWSLETTER_SITE_URL || "https://symbaiex.com";
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
