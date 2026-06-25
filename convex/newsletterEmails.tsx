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

const readSubscriberRef = makeFunctionReference<
  "query",
  { subscriberId: Id<"newsletterSubscribers"> },
  Doc<"newsletterSubscribers"> | null
>("newsletter:readSubscriber");

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
      const { segmentId, topicId } = await ensureResendListSettings(ctx, client);
      const unsubscribed = subscriber.status !== "confirmed";
      const topicSubscription = unsubscribed ? "opt_out" : "opt_in";
      let contactId = subscriber.resendContactId;

      if (!contactId) {
        const existing = await client.contacts.get({ email: subscriber.email });
        if (existing.data) {
          contactId = existing.data.id;
        } else if (existing.error && existing.error.name !== "not_found") {
          throw new Error(existing.error.message);
        }
      }

      if (contactId) {
        const updated = await client.contacts.update({
          id: contactId,
          unsubscribed,
          properties: {
            source: subscriber.source,
            status: subscriber.status,
          },
        });
        if (updated.error) {
          throw new Error(updated.error.message);
        }
        const segment = await client.contacts.segments.add({
          contactId,
          segmentId,
        });
        if (segment.error && segment.error.name !== "validation_error") {
          throw new Error(segment.error.message);
        }
        const topic = await client.contacts.topics.update({
          id: contactId,
          topics: [{ id: topicId, subscription: topicSubscription }],
        });
        if (topic.error) {
          throw new Error(topic.error.message);
        }
      } else {
        const created = await client.contacts.create({
          email: subscriber.email,
          unsubscribed,
          properties: {
            source: subscriber.source,
            status: subscriber.status,
          },
          segments: [{ id: segmentId }],
          topics: [{ id: topicId, subscription: topicSubscription }],
        });
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
      const { segmentId, topicId } = await ensureResendListSettings(ctx, client);
      const siteUrl = process.env.NEWSLETTER_SITE_URL || "https://symbaiex.com";
      const unsubscribeUrl = `${siteUrl}/newsletter/preferences`;
      const { html, text } = await renderIssueEmail(issue, unsubscribeUrl);
      const response = await client.broadcasts.create({
        name: issue.subject,
        from: fromEmail(),
        replyTo: replyToEmails(),
        subject: issue.subject,
        previewText: issue.previewText,
        html,
        text,
        segmentId,
        topicId,
        send: true,
      });
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

async function ensureResendListSettings(
  ctx: ActionCtx,
  client: ResendSdk,
) {
  const segmentId = await ensureSegment(ctx, client);
  const topicId = await ensureTopic(ctx, client);
  return { segmentId, topicId };
}

async function ensureSegment(
  ctx: ActionCtx,
  client: ResendSdk,
) {
  const existingId = await ctx.runQuery(getSettingRef, { key: SEGMENT_SETTING });
  if (existingId) {
    return existingId;
  }
  const list = await client.segments.list({ limit: 100 });
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
  const created = await client.segments.create({ name: SEGMENT_NAME });
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
) {
  const existingId = await ctx.runQuery(getSettingRef, { key: TOPIC_SETTING });
  if (existingId) {
    return existingId;
  }
  const list = await client.topics.list();
  if (list.error) {
    throw new Error(list.error.message);
  }
  const found = list.data.data.find((topic) => topic.name === TOPIC_NAME);
  if (found) {
    await ctx.runMutation(setSettingRef, { key: TOPIC_SETTING, value: found.id });
    return found.id;
  }
  const created = await client.topics.create({
    name: TOPIC_NAME,
    description: "SYMBaiEX essays, project notes, and news digests.",
    defaultSubscription: "opt_in",
  });
  if (created.error) {
    throw new Error(created.error.message);
  }
  await ctx.runMutation(setSettingRef, { key: TOPIC_SETTING, value: created.data.id });
  return created.data.id;
}

async function renderIssueEmail(
  issue: Doc<"newsletterIssues">,
  unsubscribeUrl: string,
) {
  return await renderEmail(
    <BaseEmail preview={issue.previewText}>
      <Heading style={styles.heading}>{issue.subject}</Heading>
      <Text style={styles.copy}>{issue.previewText}</Text>
      <Hr style={styles.hr} />
      <Text style={styles.body}>{issue.body}</Text>
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
          <Text style={styles.brand}>SYMBaiEX</Text>
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
    process.env.NEWSLETTER_FROM_EMAIL ||
    "SYMBaiEX <onboarding@resend.dev>"
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown error";
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
