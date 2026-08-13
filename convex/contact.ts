import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
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

function cleanText(value: string, maxLength: number) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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
  },
  handler: async (ctx, args) => {
    const patch: {
      emailedAt?: number;
      emailError?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };
    if (args.emailedAt !== undefined) {
      patch.emailedAt = args.emailedAt;
    }
    patch.emailError = args.emailError;
    await ctx.db.patch("contactRequests", args.requestId, patch);
    return null;
  },
});

