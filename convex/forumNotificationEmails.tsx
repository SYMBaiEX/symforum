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
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import { resend } from "./resendClient";

export type ForumNotificationEmailRenderContext = {
  actorName: string;
  categoryName: string;
  categorySlug: string;
  excerpt: string;
  postNumber: number | null;
  postPage: number | null;
  recipientName: string;
  threadSlug: string;
  threadTitle: string;
  toEmail: string;
  type: "reply" | "newThread";
};

type ForumNotificationEmailDeliveryContext =
  | {
      ready: false;
      reason: string;
    }
  | ({
      ready: true;
    } & ForumNotificationEmailRenderContext);

const readForumNotificationEmailDeliveryRef = makeFunctionReference<
  "query",
  { deliveryId: Id<"forumNotificationEmailDeliveries"> },
  Doc<"forumNotificationEmailDeliveries"> | null
>("forum:readForumNotificationEmailDelivery");

const markForumNotificationEmailDeliveryStateRef = makeFunctionReference<
  "mutation",
  {
    deliveryId: Id<"forumNotificationEmailDeliveries">;
    status: "queued" | "skipped" | "sent" | "failed";
    reason?: string;
    sentAt?: number;
    failedAt?: number;
    error?: string;
  },
  null
>("forum:markForumNotificationEmailDeliveryState");

const readForumNotificationEmailDeliveryContextRef = makeFunctionReference<
  "query",
  { deliveryId: Id<"forumNotificationEmailDeliveries"> },
  ForumNotificationEmailDeliveryContext
>("forum:readForumNotificationEmailDeliveryContext");

export const processQueuedDelivery = internalAction({
  args: {
    deliveryId: v.id("forumNotificationEmailDeliveries"),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.runQuery(readForumNotificationEmailDeliveryRef, {
      deliveryId: args.deliveryId,
    });
    if (delivery === null || delivery.status !== "queued") {
      return {
        processed: false,
        status: delivery?.status ?? "missing",
      };
    }

    if (env.FORUM_EMAIL_NOTIFICATIONS_ENABLED !== "true") {
      await ctx.runMutation(markForumNotificationEmailDeliveryStateRef, {
        deliveryId: args.deliveryId,
        status: "skipped",
        reason: "Forum email notifications are disabled",
      });
      return { processed: true, status: "skipped" };
    }

    if (!env.RESEND_API_KEY || !env.FORUM_FROM_EMAIL) {
      const now = Date.now();
      await ctx.runMutation(markForumNotificationEmailDeliveryStateRef, {
        deliveryId: args.deliveryId,
        status: "failed",
        failedAt: now,
        error: "Forum email notifications are not fully configured",
      });
      return { processed: true, status: "failed" };
    }

    const deliveryContext = await ctx.runQuery(
      readForumNotificationEmailDeliveryContextRef,
      {
        deliveryId: args.deliveryId,
      },
    );
    if (!deliveryContext.ready) {
      await ctx.runMutation(markForumNotificationEmailDeliveryStateRef, {
        deliveryId: args.deliveryId,
        status: "skipped",
        reason: deliveryContext.reason,
      });
      return { processed: true, status: "skipped" };
    }

    try {
      const email = await buildForumNotificationEmail(
        deliveryContext,
        forumSiteUrl(),
      );
      await resend.sendEmail(ctx, {
        from: env.FORUM_FROM_EMAIL,
        to: delivery.toEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: forumReplyToEmails(),
      });
      await ctx.runMutation(markForumNotificationEmailDeliveryStateRef, {
        deliveryId: args.deliveryId,
        status: "sent",
        sentAt: Date.now(),
      });
      return { processed: true, status: "sent" };
    } catch (error) {
      await ctx.runMutation(markForumNotificationEmailDeliveryStateRef, {
        deliveryId: args.deliveryId,
        status: "failed",
        failedAt: Date.now(),
        error: forumNotificationEmailError(error),
      });
      return { processed: true, status: "failed" };
    }
  },
});

export async function buildForumNotificationEmail(
  context: ForumNotificationEmailRenderContext,
  siteUrl: string,
) {
  const threadUrl = forumNotificationEmailUrl(context, siteUrl);
  const subject = forumNotificationEmailSubject(context);
  const watchLabel = context.type === "reply" ? "thread" : "board";
  const actionLabel =
    context.type === "reply" ? "Read the reply" : "Read the thread";
  const preview =
    context.type === "reply"
      ? `${context.actorName} replied to ${context.threadTitle}.`
      : `${context.actorName} started ${context.threadTitle}.`;

  const { html, text } = await renderEmail(
    <BaseEmail preview={preview} siteUrl={siteUrl}>
      <Heading style={styles.heading}>
        {context.type === "reply" ? "New reply" : "New thread"}
      </Heading>
      <Text style={styles.copy}>Hi {context.recipientName},</Text>
      <Text style={styles.copy}>
        {context.actorName}{" "}
        {context.type === "reply" ? "posted a reply in" : "started"}{" "}
        <Link href={threadUrl} style={styles.link}>
          {context.threadTitle}
        </Link>
        .
      </Text>
      <Section style={styles.metaBox}>
        <Text style={styles.metaLabel}>BOARD</Text>
        <Text style={styles.metaValue}>{context.categoryName}</Text>
        <Text style={styles.metaLabel}>PREVIEW</Text>
        <Text style={styles.excerpt}>{context.excerpt}</Text>
      </Section>
      <Button href={threadUrl} style={styles.button}>
        {actionLabel}
      </Button>
      <Hr style={styles.rule} />
      <Text style={styles.small}>
        You are receiving this because you watch this forum {watchLabel}. You
        can update forum notification preferences from{" "}
        <Link
          href={`${normalizeForumSiteUrl(siteUrl)}/control-panel`}
          style={styles.link}
        >
          User CP
        </Link>
        .
      </Text>
    </BaseEmail>,
  );

  return {
    html,
    subject,
    text,
    threadUrl,
  };
}

export function forumNotificationEmailSubject(
  context: ForumNotificationEmailRenderContext,
) {
  if (context.type === "reply") {
    return `[SYMBaiEX forum] New reply: ${truncateSubject(context.threadTitle)}`;
  }
  return `[SYMBaiEX forum] New thread in ${truncateSubject(
    context.categoryName,
    48,
  )}: ${truncateSubject(context.threadTitle)}`;
}

export function forumNotificationEmailUrl(
  context: Pick<
    ForumNotificationEmailRenderContext,
    "categorySlug" | "postNumber" | "postPage" | "threadSlug" | "type"
  >,
  siteUrl: string,
) {
  const base = normalizeForumSiteUrl(siteUrl);
  const query =
    context.type === "reply" &&
    context.postPage !== null &&
    context.postPage > 1
      ? `?postPage=${context.postPage}`
      : "";
  const anchor =
    context.type === "reply" && context.postNumber !== null
      ? `#post-${context.postNumber}`
      : "";
  return `${base}/${context.categorySlug}/${context.threadSlug}${query}${anchor}`;
}

async function renderEmail(children: ReactElement) {
  const html = await render(children);
  return { html, text: toPlainText(html) };
}

function BaseEmail({
  children,
  preview,
  siteUrl,
}: {
  children: ReactNode;
  preview: string;
  siteUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.page}>
        <Container style={styles.container}>
          <Link href={normalizeForumSiteUrl(siteUrl)} style={styles.brand}>
            SYMBaiEX forum
          </Link>
          <Section>{children}</Section>
          <Text style={styles.footer}>
            Old-web discussion, project notes, and community dispatches.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function forumSiteUrl() {
  return normalizeForumSiteUrl(
    env.FORUM_SITE_URL || "https://forum.symbaiex.com",
  );
}

function normalizeForumSiteUrl(siteUrl: string) {
  const normalized = siteUrl.trim();
  return (normalized || "https://forum.symbaiex.com").replace(/\/+$/, "");
}

function forumReplyToEmails() {
  const value = env.FORUM_REPLY_TO;
  const emails =
    value
      ?.split(",")
      .map((email) => email.trim())
      .filter(Boolean) ?? [];
  return emails.length === 0 ? undefined : emails;
}

function forumNotificationEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return truncateSubject(message || "Forum email delivery failed", 500);
}

function truncateSubject(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

const styles = {
  page: {
    backgroundColor: "#f2f2f2",
    color: "#111111",
    fontFamily: '"Courier New", Courier, "Lucida Console", Monaco, monospace',
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "2px solid #111111",
    borderRadius: 0,
    margin: "0 auto",
    padding: "24px",
    width: "100%",
    maxWidth: "620px",
  },
  brand: {
    color: "#111111",
    display: "block",
    fontSize: "14px",
    fontWeight: "700",
    letterSpacing: "0",
    marginBottom: "24px",
    textDecoration: "none",
    textTransform: "uppercase" as const,
  },
  heading: {
    color: "#111111",
    fontSize: "26px",
    fontWeight: "700",
    letterSpacing: "0",
    lineHeight: "1.2",
    margin: "0 0 16px",
  },
  copy: {
    color: "#222222",
    fontSize: "15px",
    lineHeight: "1.6",
    margin: "0 0 14px",
  },
  metaBox: {
    backgroundColor: "#f7f7f7",
    border: "1px solid #111111",
    margin: "20px 0",
    padding: "16px",
  },
  metaLabel: {
    color: "#555555",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0",
    margin: "0 0 4px",
  },
  metaValue: {
    color: "#111111",
    fontSize: "15px",
    lineHeight: "1.5",
    margin: "0 0 14px",
  },
  excerpt: {
    color: "#111111",
    fontSize: "14px",
    lineHeight: "1.6",
    margin: "0",
  },
  button: {
    backgroundColor: "#00d7c3",
    border: "2px solid #111111",
    borderRadius: 0,
    color: "#111111",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: "700",
    padding: "12px 18px",
    textDecoration: "none",
  },
  rule: {
    borderColor: "#111111",
    margin: "24px 0 16px",
  },
  link: {
    color: "#d4147f",
    textDecoration: "underline",
  },
  small: {
    color: "#555555",
    fontSize: "12px",
    lineHeight: "1.5",
    margin: "0 0 12px",
  },
  footer: {
    color: "#777777",
    fontSize: "11px",
    lineHeight: "1.4",
    margin: "24px 0 0",
  },
};
