import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSiteAdmin } from "./authz";

const logLevel = v.union(
  v.literal("info"),
  v.literal("warn"),
  v.literal("error"),
);
const logStatus = v.union(
  v.literal("open"),
  v.literal("reviewed"),
  v.literal("resolved"),
);
const logSource = v.union(
  v.literal("client"),
  v.literal("server"),
  v.literal("api"),
  v.literal("convex"),
);

const MESSAGE_LIMIT = 700;
const STACK_LIMIT = 2_400;
const SHORT_LIMIT = 220;
const METADATA_LIMIT = 2_000;
const FINGERPRINT_LIMIT = 500;
const DEDUPE_WINDOW_MS = 60_000;

export const record = mutation({
  args: {
    level: v.optional(logLevel),
    source: v.optional(logSource),
    scope: v.optional(v.string()),
    eventType: v.optional(v.string()),
    message: v.string(),
    name: v.optional(v.string()),
    stack: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    path: v.optional(v.string()),
    url: v.optional(v.string()),
    method: v.optional(v.string()),
    statusCode: v.optional(v.number()),
    requestId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    component: v.optional(v.string()),
    action: v.optional(v.string()),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const actorUserId = await getAuthUserId(ctx);
    const message = clean(args.message, MESSAGE_LIMIT);

    if (message.length === 0) {
      return { logged: false, deduped: false, id: null };
    }

    const level = args.level ?? "error";
    const source = args.source ?? "client";
    const scope =
      clean(args.scope ?? "application", SHORT_LIMIT) || "application";
    const eventType =
      clean(args.eventType ?? "runtime_error", SHORT_LIMIT) || "runtime_error";
    const path = optionalClean(stripQuery(args.path), SHORT_LIMIT);
    const fingerprint =
      optionalFingerprint(args.fingerprint) ??
      cleanFingerprint(
        [source, scope, eventType, path, message.slice(0, 160)].join("|"),
      );
    const recent = await ctx.db
      .query("systemLogs")
      .withIndex("by_fingerprint_and_createdAt", (q) =>
        q.eq("fingerprint", fingerprint),
      )
      .order("desc")
      .take(1);
    const existing = recent[0];

    if (
      existing !== undefined &&
      existing.status !== "resolved" &&
      now - existing.lastSeenAt < DEDUPE_WINDOW_MS
    ) {
      await ctx.db.patch("systemLogs", existing._id, {
        lastSeenAt: now,
        updatedAt: now,
        occurrences: existing.occurrences + 1,
      });
      return { logged: true, deduped: true, id: existing._id };
    }

    const id = await ctx.db.insert("systemLogs", {
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      occurrences: 1,
      level,
      status: "open",
      source,
      scope,
      eventType,
      message,
      fingerprint,
      ...(actorUserId !== null ? { actorUserId } : {}),
      ...optionalFields({
        name: optionalClean(args.name, SHORT_LIMIT),
        stack: optionalClean(args.stack, STACK_LIMIT),
        path,
        url: optionalClean(stripQuery(args.url), SHORT_LIMIT),
        method: optionalClean(args.method?.toUpperCase(), 16),
        statusCode: args.statusCode,
        requestId: optionalClean(args.requestId, SHORT_LIMIT),
        sessionId: optionalClean(args.sessionId, SHORT_LIMIT),
        userAgent: optionalClean(args.userAgent, 420),
        component: optionalClean(args.component, SHORT_LIMIT),
        action: optionalClean(args.action, SHORT_LIMIT),
        entityType: optionalClean(args.entityType, SHORT_LIMIT),
        entityId: optionalClean(args.entityId, SHORT_LIMIT),
        metadataJson: optionalClean(args.metadataJson, METADATA_LIMIT),
      }),
    });

    return { logged: true, deduped: false, id };
  },
});

export const listAdmin = query({
  args: {
    status: v.optional(logStatus),
    level: v.optional(logLevel),
    source: v.optional(logSource),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 60), 120));

    if (args.status !== undefined) {
      return await ctx.db
        .query("systemLogs")
        .withIndex("by_status_and_createdAt", (q) =>
          q.eq("status", args.status!),
        )
        .order("desc")
        .take(limit);
    }

    if (args.level !== undefined) {
      return await ctx.db
        .query("systemLogs")
        .withIndex("by_level_and_createdAt", (q) => q.eq("level", args.level!))
        .order("desc")
        .take(limit);
    }

    if (args.source !== undefined) {
      return await ctx.db
        .query("systemLogs")
        .withIndex("by_source_and_createdAt", (q) =>
          q.eq("source", args.source!),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("systemLogs")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);
  },
});

export const summaryAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const [open, reviewed, resolved, recentErrors, recentWarnings] =
      await Promise.all([
        ctx.db
          .query("systemLogs")
          .withIndex("by_status_and_createdAt", (q) => q.eq("status", "open"))
          .order("desc")
          .take(100),
        ctx.db
          .query("systemLogs")
          .withIndex("by_status_and_createdAt", (q) =>
            q.eq("status", "reviewed"),
          )
          .order("desc")
          .take(100),
        ctx.db
          .query("systemLogs")
          .withIndex("by_status_and_createdAt", (q) =>
            q.eq("status", "resolved"),
          )
          .order("desc")
          .take(100),
        ctx.db
          .query("systemLogs")
          .withIndex("by_level_and_createdAt", (q) => q.eq("level", "error"))
          .order("desc")
          .take(100),
        ctx.db
          .query("systemLogs")
          .withIndex("by_level_and_createdAt", (q) => q.eq("level", "warn"))
          .order("desc")
          .take(100),
      ]);

    return {
      sampleSize: {
        open: open.length,
        reviewed: reviewed.length,
        resolved: resolved.length,
        errors: recentErrors.length,
        warnings: recentWarnings.length,
      },
      newestOpenAt: open[0]?.createdAt ?? null,
    };
  },
});

export const updateStatusAdmin = mutation({
  args: {
    logId: v.id("systemLogs"),
    status: logStatus,
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const existing = await ctx.db.get("systemLogs", args.logId);
    if (existing === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "System log was not found.",
      });
    }

    await ctx.db.patch("systemLogs", args.logId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { updated: true };
  },
});

export const deleteAdmin = mutation({
  args: { logId: v.id("systemLogs") },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const existing = await ctx.db.get("systemLogs", args.logId);
    if (existing === null) {
      return { deleted: false };
    }
    await ctx.db.delete("systemLogs", args.logId);
    return { deleted: true };
  },
});

function optionalFields<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function optionalClean(value: string | undefined, limit: number) {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = clean(value, limit);
  return cleaned.length > 0 ? cleaned : undefined;
}

function clean(value: string, limit: number) {
  return redact(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function optionalFingerprint(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const fingerprint = cleanFingerprint(value);
  return fingerprint.length > 0 ? fingerprint : undefined;
}

function cleanFingerprint(value: string) {
  return clean(
    value.replace(/\[Request ID:\s*[^\]]+\]/gi, "[Request ID]"),
    FINGERPRINT_LIMIT,
  );
}

function stripQuery(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  const [withoutHash] = value.split("#");
  const [withoutQuery] = withoutHash.split("?");
  return withoutQuery;
}

function redact(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(re|sk|sym|jrt)_[A-Za-z0-9_-]{12,}\b/g, "[secret]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [secret]")
    .replace(/password["':=\s]+[^,\s}]+/gi, "password=[secret]");
}
