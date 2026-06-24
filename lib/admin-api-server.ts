import {
  type AdminCommentRecord,
  type AdminInteractionRecord,
  type ConvexPostRecord,
} from "@/lib/convex-refs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONVEX_ID_PATTERN = /^[a-z0-9]+$/i;

export type ApiPostInput = {
  slug?: string;
  title: string;
  excerpt: string;
  body: string;
  tags: string[];
  status: "draft" | "published";
  publishedAt: number;
  readingMinutes: number;
  featured: boolean;
  imageUrl?: string;
  imageAlt?: string;
  imageCredit?: string;
};

export const adminApiRefs = {
  listPosts: makeFunctionReference<
    "mutation",
    { tokenHash: string },
    ConvexPostRecord[]
  >("adminApi:listPosts"),
  getPost: makeFunctionReference<
    "mutation",
    { tokenHash: string; slug: string },
    ConvexPostRecord | null
  >("adminApi:getPost"),
  upsertPost: makeFunctionReference<
    "mutation",
    { tokenHash: string; post: ApiPostInput },
    ConvexPostRecord | null
  >("adminApi:upsertPost"),
  deletePost: makeFunctionReference<
    "mutation",
    { tokenHash: string; slug: string },
    { deleted: boolean }
  >("adminApi:deletePost"),
  listComments: makeFunctionReference<
    "mutation",
    {
      tokenHash: string;
      entityType?: "post" | "hnStory";
      entityId?: string;
    },
    AdminCommentRecord[]
  >("adminApi:listComments"),
  deleteComment: makeFunctionReference<
    "mutation",
    { tokenHash: string; commentId: string },
    { deleted: boolean }
  >("adminApi:deleteComment"),
  listInteractions: makeFunctionReference<
    "mutation",
    {
      tokenHash: string;
      entityType?: "post" | "hnStory";
      entityId?: string;
    },
    AdminInteractionRecord[]
  >("adminApi:listInteractions"),
  deleteInteraction: makeFunctionReference<
    "mutation",
    { tokenHash: string; interactionId: string },
    { deleted: boolean }
  >("adminApi:deleteInteraction"),
};

export class AdminApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function adminConvexClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new AdminApiError(503, "Convex is not configured");
  }
  return new ConvexHttpClient(url);
}

export function tokenHashFromRequest(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new AdminApiError(401, "Missing bearer token");
  }
  return createHash("sha256").update(token).digest("hex");
}

export function apiError(error: unknown) {
  if (error instanceof AdminApiError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  if (isUnauthorizedApiError(error)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: "API request failed",
    },
    {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function isUnauthorizedApiError(error: unknown) {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data?: unknown }).data
      : undefined;
  return (
    (error instanceof Error && error.message.includes("Unauthorized")) ||
    (isRecord(data) && data.code === "UNAUTHORIZED")
  );
}

export function jsonOk<T>(payload: T, status = 200) {
  return NextResponse.json(
    { ok: true, ...payload },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AdminApiError(415, "Content-Type must be application/json");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_JSON_BODY_BYTES) {
    throw new AdminApiError(413, "JSON body is too large");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new AdminApiError(413, "JSON body is too large");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdminApiError(400, "Invalid JSON body");
  }
}

export function normalizeSlugParam(slug: string) {
  const clean = slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(clean) || clean.length > 96) {
    throw new AdminApiError(400, "Invalid slug");
  }
  return clean;
}

export function normalizeConvexIdParam(id: string) {
  const clean = id.trim();
  if (
    clean.length < 8 ||
    clean.length > 128 ||
    !CONVEX_ID_PATTERN.test(clean)
  ) {
    throw new AdminApiError(400, "Invalid id");
  }
  return clean;
}

export function normalizeApiPostPayload(
  payload: unknown,
  fallback?: ConvexPostRecord,
): ApiPostInput {
  const source = unwrapPostPayload(payload);
  const title = stringField(source.title, fallback?.title);
  const body = bodyField(source.body, fallback?.body);
  const excerpt = stringField(
    source.excerpt,
    fallback?.excerpt ?? body.slice(0, 220),
  );

  const post: ApiPostInput = {
    title,
    excerpt,
    body,
    tags: tagsField(source.tags, fallback?.tags ?? []),
    status: statusField(source.status, fallback?.status ?? "draft"),
    publishedAt: dateField(source.publishedAt, fallback?.publishedAt),
    readingMinutes: numberField(
      source.readingMinutes,
      fallback?.readingMinutes ?? estimateReadingMinutes(body),
    ),
    featured: booleanField(source.featured, fallback?.featured ?? false),
  };

  const slug = optionalString(source.slug, fallback?.slug);
  const imageUrl = optionalString(source.imageUrl, fallback?.imageUrl);
  const imageAlt = optionalString(source.imageAlt, fallback?.imageAlt);
  const imageCredit = optionalString(source.imageCredit, fallback?.imageCredit);
  if (slug) {
    post.slug = slug;
  }
  if (imageUrl) {
    post.imageUrl = imageUrl;
  }
  if (imageAlt) {
    post.imageAlt = imageAlt;
  }
  if (imageCredit) {
    post.imageCredit = imageCredit;
  }

  return post;
}

function unwrapPostPayload(payload: unknown) {
  if (!isRecord(payload)) {
    throw new AdminApiError(400, "Body must be a JSON object");
  }
  const nested = payload.post;
  return isRecord(nested) ? nested : payload;
}

function stringField(value: unknown, fallback?: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (fallback && fallback.trim()) {
    return fallback.trim();
  }
  throw new AdminApiError(400, "Missing required post field");
}

function optionalString(value: unknown, fallback?: string) {
  if (typeof value === "string") {
    const clean = value.trim();
    return clean || undefined;
  }
  return fallback;
}

function bodyField(value: unknown, fallback?: string) {
  if (Array.isArray(value)) {
    return value.map(String).join("\n\n").trim();
  }
  return stringField(value, fallback);
}

function tagsField(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return fallback;
}

function statusField(value: unknown, fallback: "draft" | "published") {
  return value === "draft" || value === "published" ? value : fallback;
}

function dateField(value: unknown, fallback?: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback ?? Date.now();
}

function numberField(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function booleanField(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function estimateReadingMinutes(body: string) {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
