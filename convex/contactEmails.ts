import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import { resend } from "./resendClient";

const readContactRequestRef = makeFunctionReference<
  "query",
  { requestId: Id<"contactRequests"> },
  Doc<"contactRequests"> | null
>("contact:readContactRequest");

const markContactRequestEmailStateRef = makeFunctionReference<
  "mutation",
  {
    requestId: Id<"contactRequests">;
    emailedAt?: number;
    emailError?: string;
    resendEmailId?: string;
    emailDeliveryStatus?:
      | "queued"
      | "sent"
      | "delivered"
      | "bounced"
      | "complained"
      | "failed"
      | "delivery_delayed";
  },
  null
>("contact:markContactRequestEmailState");

export const sendContactRequestEmail = internalAction({
  args: { requestId: v.id("contactRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(readContactRequestRef, {
      requestId: args.requestId,
    });
    if (request === null) {
      return null;
    }

    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(markContactRequestEmailStateRef, {
        requestId: args.requestId,
        emailError: "RESEND_API_KEY is not configured",
      });
      return null;
    }

    try {
      const from = env.CONTACT_FROM_EMAIL || env.NEWSLETTER_FROM_EMAIL;
      const to = env.CONTACT_NOTIFICATION_TO;
      if (!from || !to) throw Error("Configure CONTACT_FROM_EMAIL and CONTACT_NOTIFICATION_TO before contact delivery.");
      const resendEmailId = await resend.sendEmail(ctx, {
        from,
        to,
        replyTo: [request.email],
        subject: contactSubject(request.subject),
        text: contactText(request),
        html: contactHtml(request),
      });
      await ctx.runMutation(markContactRequestEmailStateRef, {
        requestId: args.requestId,
        resendEmailId,
        emailDeliveryStatus: "queued",
      });
    } catch (error) {
      await ctx.runMutation(markContactRequestEmailStateRef, {
        requestId: args.requestId,
        emailError: limitText(
          error instanceof Error
            ? error.message
            : "Contact email could not be queued",
          900,
        ),
        emailDeliveryStatus: "failed",
      });
    }
    return null;
  },
});

function contactSubject(subject: string) {
  return limitText(`Contact: ${subject}`, 140);
}

function contactText(request: Doc<"contactRequests">) {
  return [
    "New SYMBaiEX contact request",
    "",
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    `Subject: ${request.subject}`,
    `Submitted: ${new Date(request.createdAt).toISOString()}`,
    request.source ? `Source: ${request.source}` : null,
    "",
    request.description,
  ]
    .filter(Boolean)
    .join("\n");
}

function contactHtml(request: Doc<"contactRequests">) {
  const rows = [
    ["Name", request.name],
    ["Email", request.email],
    ["Subject", request.subject],
    ["Submitted", new Date(request.createdAt).toISOString()],
    request.source ? ["Source", request.source] : null,
  ].filter(Boolean) as string[][];

  return `<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#f7f7f7;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:680px;margin:0 auto;padding:32px 24px;">
      <p style="margin:0 0 20px;font-family:monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a8a8a8;">SYMBaiEX contact</p>
      <h1 style="margin:0 0 28px;font-size:28px;line-height:1.05;">${escapeHtml(request.subject)}</h1>
      <div style="display:grid;gap:10px;margin-bottom:28px;">
        ${rows
          .map(
            ([label, value]) => `
        <div style="display:grid;grid-template-columns:110px 1fr;gap:14px;">
          <span style="font-family:monospace;font-size:12px;text-transform:uppercase;color:#8f8f8f;">${escapeHtml(label)}</span>
          <span style="font-size:15px;color:#f7f7f7;">${escapeHtml(value)}</span>
        </div>`,
          )
          .join("")}
      </div>
      <section style="border:1px solid #2e2e2e;padding:18px 20px;">
        <p style="white-space:pre-wrap;margin:0;font-size:16px;line-height:1.65;color:#e8e8e8;">${escapeHtml(request.description)}</p>
      </section>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function limitText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}
