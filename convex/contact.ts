import { getAuthUserId } from "@convex-dev/auth/server";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { EmailEvent } from "@convex-dev/resend";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";

export const contactRequestStatusValidator = v.union(
  v.literal("new"),
  v.literal("read"),
  v.literal("archived"),
);

const contactRequestInputValidator = v.object({
  name: v.string(),
  email: v.string(),
  subject: v.string(),
  description: v.string(),
  source: v.optional(v.string()),
  userAgent: v.optional(v.string()),
});

const sendContactRequestEmailRef = makeFunctionReference<
  "action",
  { requestId: Id<"contactRequests"> },
  null
>("contactEmails:sendContactRequestEmail");

const publicContactRateLimiter = new RateLimiter(components.rateLimiter, {
  anonymousContactSubmissions: {
    kind: "token bucket",
    rate: 6,
    period: HOUR,
    capacity: 3,
  },
});

function cleanText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanMultiline(value: string, maxLength: number) {
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicContactRequest(request: Doc<"contactRequests">) {
  return {
    _id: request._id,
    _creationTime: request._creationTime,
    name: request.name,
    email: request.email,
    subject: request.subject,
    description: request.description,
    status: request.status,
    source: request.source,
    userAgent: request.userAgent,
    emailedAt: request.emailedAt,
    emailError: request.emailError,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export const submit = mutation({
  args: { request: contactRequestInputValidator },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = cleanText(args.request.name, 90);
    const email = cleanText(args.request.email, 180);
    const emailNormalized = normalizeEmail(email);
    const subject = cleanText(args.request.subject, 140);
    const description = cleanMultiline(args.request.description, 5000);
    const source = args.request.source
      ? cleanText(args.request.source, 80)
      : undefined;
    const userAgent = args.request.userAgent
      ? cleanText(args.request.userAgent, 240)
      : undefined;

    if (name.length < 2) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Name must be at least 2 characters",
      });
    }
    if (!isValidEmail(emailNormalized)) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Enter a valid email address",
      });
    }
    if (subject.length < 3) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Subject must be at least 3 characters",
      });
    }
    if (description.length < 12) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "Description must be at least 12 characters",
      });
    }

    const actorUserId = await getAuthUserId(ctx);
    if (actorUserId === null) {
      const capacity = await publicContactRateLimiter.limit(
        ctx,
        "anonymousContactSubmissions",
        {
          // Deliberately global: email addresses are caller controlled and
          // cannot serve as independent rate-limit keys.
          key: "global",
        },
      );
      if (!capacity.ok) {
        throw new ConvexError({
          code: "RATE_LIMITED",
          message:
            "Contact form capacity is temporarily full. Please try again later.",
          retryAfter: capacity.retryAfter,
        });
      }
    }

    const recentFromEmail = await ctx.db
      .query("contactRequests")
      .withIndex("by_emailNormalized_and_createdAt", (q) =>
        q.eq("emailNormalized", emailNormalized),
      )
      .order("desc")
      .take(3);
    if (
      recentFromEmail.some((request) => request.createdAt > now - 5 * 60 * 1000)
    ) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "Please wait a few minutes before sending another note",
      });
    }

    const requestId = await ctx.db.insert("contactRequests", {
      name,
      email,
      emailNormalized,
      subject,
      description,
      status: "new",
      source,
      userAgent,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, sendContactRequestEmailRef, { requestId });
    const request = await ctx.db.get("contactRequests", requestId);
    if (request === null) {
      throw new Error("Contact request could not be loaded");
    }
    return { ok: true, request: publicContactRequest(request) };
  },
});

export const readContactRequest = internalQuery({
  args: { requestId: v.id("contactRequests") },
  handler: async (ctx, args) => {
    return await ctx.db.get("contactRequests", args.requestId);
  },
});

export const markContactRequestEmailState = internalMutation({
  args: {
    requestId: v.id("contactRequests"),
    emailedAt: v.optional(v.number()),
    emailError: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    emailDeliveryStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("sent"),
        v.literal("delivered"),
        v.literal("bounced"),
        v.literal("complained"),
        v.literal("failed"),
        v.literal("delivery_delayed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const patch: {
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
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };
    if (args.emailedAt !== undefined) {
      patch.emailedAt = args.emailedAt;
    }
    if (args.resendEmailId !== undefined) {
      patch.resendEmailId = args.resendEmailId;
    }
    if (args.emailDeliveryStatus !== undefined) {
      patch.emailDeliveryStatus = args.emailDeliveryStatus;
    }
    patch.emailError = args.emailError;
    await ctx.db.patch("contactRequests", args.requestId, patch);
    return null;
  },
});

export async function applyContactEmailEvent(
  ctx: MutationCtx,
  args: { resendEmailId: string; event: EmailEvent },
) {
  const request = await ctx.db
    .query("contactRequests")
    .withIndex("by_resendEmailId", (q) =>
      q.eq("resendEmailId", args.resendEmailId),
    )
    .unique();
  if (request === null) {
    return false;
  }

  const eventId = `${args.resendEmailId}:${args.event.type}:${args.event.created_at}`;
  const existing = await ctx.db
    .query("contactEmailEvents")
    .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
    .unique();
  if (existing !== null) {
    return true;
  }

  const now = Date.now();
  await ctx.db.insert("contactEmailEvents", {
    eventId,
    resendEmailId: args.resendEmailId,
    eventType: args.event.type,
    receivedAt: now,
  });
  const status = contactDeliveryStatus(args.event.type);
  const error =
    status === "bounced"
      ? "Contact notification bounced"
      : status === "complained"
        ? "Contact notification was marked as spam"
        : status === "failed"
          ? "Contact notification failed"
          : undefined;
  await ctx.db.patch("contactRequests", request._id, {
    ...(status === null ? {} : { emailDeliveryStatus: status }),
    ...(status === "sent" || status === "delivered"
      ? { emailedAt: request.emailedAt ?? now }
      : {}),
    emailEventAt: now,
    ...(status === null ? {} : { emailError: error }),
    updatedAt: now,
  });
  return true;
}

function contactDeliveryStatus(eventType: EmailEvent["type"]) {
  switch (eventType) {
    case "email.sent":
      return "sent" as const;
    case "email.delivered":
      return "delivered" as const;
    case "email.bounced":
      return "bounced" as const;
    case "email.complained":
      return "complained" as const;
    case "email.delivery_delayed":
      return "delivery_delayed" as const;
    case "email.failed":
      return "failed" as const;
    default:
      // Engagement-only events such as opens/clicks are retained in the
      // idempotency ledger but must not overwrite the delivery lifecycle.
      return null;
  }
}
