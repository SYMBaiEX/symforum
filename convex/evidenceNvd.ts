import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  env,
  internalAction,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";

const NVD_HOST = "services.nvd.nist.gov";
const CVE_ENDPOINT = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const HISTORY_ENDPOINT =
  "https://services.nvd.nist.gov/rest/json/cvehistory/2.0";
const NVD_HOME = "https://nvd.nist.gov/developers/vulnerabilities";
export const NVD_TERMS_URL = "https://nvd.nist.gov/general/terms-of-use";
const NVD_ATTRIBUTION =
  "National Vulnerability Database (NVD), National Institute of Standards and Technology";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS_PER_PAGE = 100;
const DEFAULT_RESULTS_PER_PAGE = 25;
const MIN_RESULTS_PER_PAGE = 1;
const MAX_FAILURE_COUNT = 12;
const BASE_RETRY_MS = 10 * 60 * 1_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1_000;
const WINDOW_MS = 2 * 60 * 60 * 1_000;
const OVERLAP_MS = 15 * 60 * 1_000;
const MAX_WINDOW_MS = 120 * 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 20_000;

type NvdKind = "cves" | "history";
type SourceState = {
  cursor: string;
  lastSucceededAt: number;
  ingestionEnabled: boolean;
  status: "active" | "paused" | "retired";
};
type Cursor = {
  windowStart: number;
  windowEnd: number;
  startIndex: number;
  pageSize?: number;
  failureCount?: number;
  retryNotBefore?: number;
};
type Normalized = {
  externalKey: string;
  canonicalUrl: string;
  title: string;
  excerpt: string;
  searchText: string;
  tags: string[];
  authors: string[];
  publishedAt?: number;
  sourceRevision: string;
  sourceUpdatedAt: number;
  metadata: Record<string, string | number | null>;
  cveId?: string;
};

const sourceStateRef = makeFunctionReference<
  "query",
  { sourceKey: string },
  SourceState | null
>("evidenceNvd:sourceState");
const upsertSourceRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { sourceId: string }
>("evidence:upsertSource");
const upsertVersionRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  {
    documentId: string;
    versionId: string;
    version: number;
    idempotent: boolean;
    changedFields: string[];
  }
>("evidence:upsertDocumentVersion");
const upsertEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { entityId: string; created: boolean }
>("evidence:upsertEntity");
const linkEntityRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { linkId: string; created: boolean }
>("evidence:linkDocumentEntity");
const upsertClaimRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { claimId: string; created: boolean }
>("evidence:upsertClaim");
const citationRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  { citationId: string; created: boolean }
>("evidence:recordCitation");
const webhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType: "evidence.document.changed" | "evidence.claim.verified";
    payloadJson: string;
  },
  { eventId: string | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");
const logRef = makeFunctionReference<
  "mutation",
  Record<string, unknown>,
  unknown
>("systemLogs:record");

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown, maximum = 700) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maximum)
    : "";
}
function time(value: unknown) {
  const result = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : undefined;
}
function isCve(value: string) {
  return /^CVE-\d{4}-\d{4,}$/i.test(value);
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function hash(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// `convex codegen` refreshes Env after this additive config declaration is
// deployed. The intersection keeps the pre-codegen local typecheck strict
// without falling back to process.env in Convex code.
const configuredNvdApiKey = (env as typeof env & { NVD_API_KEY?: string })
  .NVD_API_KEY;

export function nvdRequestHeaders(
  endpoint: string,
  apiKey = configuredNvdApiKey,
) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.hostname !== NVD_HOST)
    return { Accept: "application/json" };
  return {
    Accept: "application/json",
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
  };
}

export function parseCursor(value: string): Cursor | null {
  try {
    const parsed = record(JSON.parse(value));
    if (
      !parsed ||
      !Number.isFinite(parsed.windowStart) ||
      !Number.isFinite(parsed.windowEnd) ||
      !Number.isInteger(parsed.startIndex) ||
      (parsed.pageSize !== undefined &&
        (typeof parsed.pageSize !== "number" ||
          !Number.isInteger(parsed.pageSize) ||
          parsed.pageSize < MIN_RESULTS_PER_PAGE ||
          parsed.pageSize > MAX_RESULTS_PER_PAGE)) ||
      (parsed.failureCount !== undefined &&
        (typeof parsed.failureCount !== "number" ||
          !Number.isInteger(parsed.failureCount) ||
          parsed.failureCount < 0 ||
          parsed.failureCount > MAX_FAILURE_COUNT)) ||
      (parsed.retryNotBefore !== undefined &&
        !Number.isFinite(parsed.retryNotBefore))
    )
      return null;
    const cursor = parsed as unknown as Cursor;
    return cursor.windowStart >= 0 &&
      cursor.windowEnd >= cursor.windowStart &&
      cursor.windowEnd - cursor.windowStart <= MAX_WINDOW_MS &&
      cursor.startIndex >= 0
      ? {
          ...cursor,
          pageSize: cursor.pageSize ?? DEFAULT_RESULTS_PER_PAGE,
          failureCount: cursor.failureCount ?? 0,
        }
      : null;
  } catch {
    return null;
  }
}
export function nextNvdCursor(state: SourceState | null, now: number): Cursor {
  const existing = parseCursor(state?.cursor ?? "");
  if (existing) return existing;
  const lastSucceededAt = Math.min(state?.lastSucceededAt ?? 0, now);
  const start =
    lastSucceededAt > 0
      ? Math.max(0, lastSucceededAt - OVERLAP_MS)
      : Math.max(0, now - WINDOW_MS - OVERLAP_MS);
  return {
    windowStart: start,
    windowEnd: Math.min(now, start + WINDOW_MS + OVERLAP_MS),
    startIndex: 0,
    pageSize: DEFAULT_RESULTS_PER_PAGE,
    failureCount: 0,
  };
}
export function buildNvdUrl(kind: NvdKind, cursor: Cursor) {
  const endpoint = new URL(kind === "cves" ? CVE_ENDPOINT : HISTORY_ENDPOINT);
  endpoint.searchParams.set(
    kind === "cves" ? "lastModStartDate" : "changeStartDate",
    new Date(cursor.windowStart).toISOString(),
  );
  endpoint.searchParams.set(
    kind === "cves" ? "lastModEndDate" : "changeEndDate",
    new Date(cursor.windowEnd).toISOString(),
  );
  endpoint.searchParams.set("startIndex", String(cursor.startIndex));
  endpoint.searchParams.set(
    "resultsPerPage",
    String(cursor.pageSize ?? DEFAULT_RESULTS_PER_PAGE),
  );
  return endpoint.toString();
}

function englishDescription(cve: Record<string, unknown>) {
  const descriptions = array(cve.descriptions)
    .map(record)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  return text(
    descriptions.find((entry) => text(entry.lang, 16).toLowerCase() === "en")
      ?.value,
    700,
  );
}
export function parseNvdCves(payload: unknown): Normalized[] {
  const root = record(payload);
  return array(root?.vulnerabilities)
    .slice(0, MAX_RESULTS_PER_PAGE)
    .flatMap((item) => {
      const cve = record(record(item)?.cve);
      const id = text(cve?.id, 32).toUpperCase();
      if (!cve || !isCve(id)) return [];
      const description = englishDescription(cve) || "NVD CVE record.";
      const publishedAt = time(cve.published);
      const updatedAt = time(cve.lastModified) ?? publishedAt ?? 0;
      const status = text(cve.vulnStatus, 80);
      return [
        {
          externalKey: id,
          canonicalUrl: `https://nvd.nist.gov/vuln/detail/${id}`,
          title: `${id}: ${description}`.slice(0, 1_000),
          excerpt: description,
          searchText: `${id} ${description} ${status}`.slice(0, 2_000),
          tags: ["nvd", "cve", status.toLowerCase()].filter(Boolean),
          authors: [NVD_ATTRIBUTION],
          publishedAt,
          sourceRevision: text(cve.lastModified, 120) || id,
          sourceUpdatedAt: updatedAt,
          metadata: {
            cveId: id,
            vulnStatus: status,
            published: text(cve.published, 80),
            lastModified: text(cve.lastModified, 80),
            sourceIdentifier: text(cve.sourceIdentifier, 160),
            attribution: NVD_ATTRIBUTION,
          },
          cveId: id,
        },
      ];
    });
}
export function parseNvdChangeHistory(payload: unknown): Normalized[] {
  const root = record(payload);
  return array(root?.cveChanges)
    .slice(0, MAX_RESULTS_PER_PAGE)
    .flatMap((item) => {
      const change = record(record(item)?.change);
      const id = text(change?.cveId, 32).toUpperCase();
      const eventId = text(change?.cveChangeId, 80).toLowerCase();
      if (!change || !isCve(id) || !isUuid(eventId)) return [];
      const eventName = text(change.eventName, 240) || "CVE change";
      const created = text(change.created, 80);
      const occurredAt = time(created) ?? 0;
      return [
        {
          externalKey: `nvd-change:${eventId}`,
          canonicalUrl: `https://nvd.nist.gov/vuln/detail/${id}`,
          title: `${id}: ${eventName}`.slice(0, 1_000),
          excerpt: `NVD recorded ${eventName} for ${id}.`,
          searchText:
            `${id} ${eventName} ${text(change.sourceIdentifier, 160)}`.slice(
              0,
              2_000,
            ),
          tags: ["nvd", "cve-change", id.toLowerCase()],
          authors: [NVD_ATTRIBUTION],
          publishedAt: occurredAt || undefined,
          sourceRevision: eventId,
          sourceUpdatedAt: occurredAt,
          metadata: {
            cveId: id,
            cveChangeId: eventId,
            eventName,
            created,
            sourceIdentifier: text(change.sourceIdentifier, 160),
            attribution: NVD_ATTRIBUTION,
          },
        },
      ];
    });
}
export function totalResults(payload: unknown) {
  const value = record(payload)?.totalResults;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

type NvdPage = {
  documents: Normalized[];
  nextCursor: string | null;
};

export type NvdPaginationDiagnostic = {
  code: "metadata" | "incomplete" | "invalid-document";
  cursorStartIndex: number;
  totalResults: number | null;
  resultsPerPage: number | null;
  itemCount: number;
};

export class NvdPaginationError extends Error {
  readonly diagnostic: NvdPaginationDiagnostic;

  constructor(message: string, diagnostic: NvdPaginationDiagnostic) {
    super(message);
    this.name = "NvdPaginationError";
    this.diagnostic = diagnostic;
  }
}

function paginationError(
  code: NvdPaginationDiagnostic["code"],
  message: string,
  cursor: Cursor,
  total: number | null,
  pageSize: number,
  itemCount: number,
) {
  return new NvdPaginationError(message, {
    code,
    cursorStartIndex: cursor.startIndex,
    totalResults: total,
    resultsPerPage: Number.isSafeInteger(pageSize) ? pageSize : null,
    itemCount,
  });
}

/**
 * NVD pagination is a correctness boundary: an absent or inconsistent count
 * must never be interpreted as a completed window. Doing so would advance the
 * source watermark and silently drop the remaining CVEs.
 */
export function parseNvdPage(
  kind: NvdKind,
  cursor: Cursor,
  payload: unknown,
): NvdPage {
  const root = record(payload);
  const total = totalResults(payload);
  const responseStartIndex = root?.startIndex;
  const resultsPerPage = root?.resultsPerPage;
  const pageSize =
    typeof resultsPerPage === "number" ? resultsPerPage : Number.NaN;
  const requestedPageSize = cursor.pageSize ?? DEFAULT_RESULTS_PER_PAGE;
  const rawItems = array(
    kind === "cves" ? root?.vulnerabilities : root?.cveChanges,
  );

  if (
    total === null ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 0 ||
    pageSize > requestedPageSize ||
    responseStartIndex !== cursor.startIndex ||
    cursor.startIndex > total ||
    rawItems.length !== pageSize ||
    rawItems.length > total - cursor.startIndex
  ) {
    throw paginationError(
      "metadata",
      "NVD returned malformed pagination metadata",
      cursor,
      total,
      pageSize,
      rawItems.length,
    );
  }

  const remaining = total - cursor.startIndex;
  // The official API reports `resultsPerPage: 0` for an empty window. It is
  // safe only at the initial cursor; accepting it for a nonempty/end cursor
  // could turn a malformed response into a dropped page.
  if (total === 0 && cursor.startIndex === 0 && pageSize === 0)
    return { documents: [], nextCursor: null };
  if (
    remaining === 0 ||
    (remaining > 0 && rawItems.length === 0) ||
    (remaining > pageSize && rawItems.length !== pageSize)
  ) {
    throw paginationError(
      "incomplete",
      "NVD returned an incomplete pagination page",
      cursor,
      total,
      pageSize,
      rawItems.length,
    );
  }

  const documents =
    kind === "cves" ? parseNvdCves(payload) : parseNvdChangeHistory(payload);
  // A malformed record is not safe to discard while moving the page cursor.
  if (documents.length !== rawItems.length)
    throw paginationError(
      "invalid-document",
      "NVD returned an invalid document in a pagination page",
      cursor,
      total,
      pageSize,
      rawItems.length,
    );

  const consumed = cursor.startIndex + rawItems.length;
  const {
    retryNotBefore: _retryNotBefore,
    failureCount: _failureCount,
    ...pageCursor
  } = cursor;
  return {
    documents,
    nextCursor:
      consumed < total
        ? JSON.stringify({
            ...pageCursor,
            startIndex: consumed,
            pageSize: Math.min(
              DEFAULT_RESULTS_PER_PAGE,
              Math.max(pageSize, (cursor.pageSize ?? pageSize) * 2),
            ),
            failureCount: 0,
          })
        : null,
  };
}

type SourceCheckpoint = {
  cursor: string;
  lastFetchedAt: number;
  lastSucceededAt: number;
  lastErrorAt: number;
  lastErrorMessage: string;
};

/** Persist before writes so an interrupted action replays this exact page. */
export function nvdInProgressCheckpoint(
  cursor: Cursor,
  lastSucceededAt: number,
  now: number,
): SourceCheckpoint {
  return {
    cursor: JSON.stringify(cursor),
    lastFetchedAt: now,
    lastSucceededAt,
    lastErrorAt: 0,
    lastErrorMessage: "",
  };
}

/** Retain the exact fetched page until every one of its mutations succeeds. */
export function nvdFailureCheckpoint(
  cursor: Cursor,
  lastSucceededAt: number,
  now: number,
  message: string,
): SourceCheckpoint {
  return {
    cursor: JSON.stringify(cursor),
    lastFetchedAt: now,
    lastSucceededAt,
    lastErrorAt: now,
    lastErrorMessage: message,
  };
}

/** A page's checkpoint is only advanced after all of its document writes finish. */
export function nvdSuccessCheckpoint(
  nextCursor: string | null,
  now: number,
): SourceCheckpoint {
  return {
    cursor: nextCursor ?? "",
    lastFetchedAt: now,
    lastSucceededAt: now,
    lastErrorAt: 0,
    lastErrorMessage: "",
  };
}

/**
 * Version writes are idempotent, but their dependent claim/citation/webhook
 * mutations are separately durable. A replay must reconcile them even when
 * the document version was committed by a prior interrupted attempt.
 */
export function nvdPostVersionWork(kind: NvdKind, idempotent: boolean) {
  return {
    writeCveClaim: kind === "cves",
    enqueueDocumentEvent: true,
    replayingCommittedVersion: idempotent,
  };
}
export function retryAfterMs(value: string | null, now: number) {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(Math.round(seconds * 1_000), 60 * 60 * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(Math.max(1_000, date - now), 60 * 60 * 1_000)
    : 60_000;
}

export function nvdRetryCursor(
  cursor: Cursor,
  error: {
    name?: string;
    retryAfter?: number;
    diagnostic?: NvdPaginationDiagnostic;
  },
  now: number,
): Cursor {
  const failureCount = Math.min(
    MAX_FAILURE_COUNT,
    (cursor.failureCount ?? 0) + 1,
  );
  const shouldShrink =
    error.name === "NvdResponseTooLargeError" ||
    error.name === "NvdRequestTimeoutError" ||
    error.name === "AbortError" ||
    error.name === "NvdPaginationError";
  const currentPageSize = cursor.pageSize ?? DEFAULT_RESULTS_PER_PAGE;
  const pageSize = shouldShrink
    ? Math.max(MIN_RESULTS_PER_PAGE, Math.floor(currentPageSize / 2))
    : currentPageSize;
  const restartWindow =
    error.name === "NvdPaginationError" &&
    error.diagnostic?.totalResults !== null &&
    error.diagnostic?.totalResults !== undefined &&
    error.diagnostic.totalResults < cursor.startIndex;
  const exponentialDelay = Math.min(
    MAX_RETRY_MS,
    BASE_RETRY_MS * 2 ** Math.min(failureCount - 1, 8),
  );
  return {
    ...cursor,
    startIndex: restartWindow ? 0 : cursor.startIndex,
    pageSize,
    failureCount,
    retryNotBefore:
      now + Math.max(exponentialDelay, error.retryAfter ?? BASE_RETRY_MS),
  };
}

export async function readBoundedNvdResponse(
  response: Pick<Response, "arrayBuffer" | "body" | "headers">,
) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    const error = new Error("NVD response exceeded 2 MiB limit") as Error & {
      name: string;
    };
    error.name = "NvdResponseTooLargeError";
    throw error;
  }
  if (response.body === null) {
    const fallback = new Uint8Array(await response.arrayBuffer());
    if (fallback.byteLength > MAX_RESPONSE_BYTES) {
      const error = new Error("NVD response exceeded 2 MiB limit") as Error & {
        name: string;
      };
      error.name = "NvdResponseTooLargeError";
      throw error;
    }
    return fallback;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      const error = new Error("NVD response exceeded 2 MiB limit") as Error & {
        name: string;
      };
      error.name = "NvdResponseTooLargeError";
      throw error;
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchNvd(endpoint: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "SYMBaiEX-Evidence-NVD/1.0 (+https://www.symbaiex.com)",
        ...nvdRequestHeaders(endpoint),
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(
        `NVD returned HTTP ${response.status}`,
      ) as Error & { status?: number; retryAfter?: number };
      error.status = response.status;
      error.retryAfter = retryAfterMs(
        response.headers.get("retry-after"),
        Date.now(),
      );
      throw error;
    }
    const body = await readBoundedNvdResponse(response);
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error("NVD request timed out") as Error & {
        name: string;
      };
      timeout.name = "NvdRequestTimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const sourceState = internalQuery({
  args: { sourceKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      cursor: v.string(),
      lastSucceededAt: v.number(),
      ingestionEnabled: v.boolean(),
      status: v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("retired"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) =>
        q.eq("sourceKey", args.sourceKey.toLowerCase()),
      )
      .unique();
    return source
      ? {
          cursor: source.cursor,
          lastSucceededAt: source.lastSucceededAt,
          ingestionEnabled: source.ingestionEnabled,
          status: source.status,
        }
      : null;
  },
});

const resultValidator = v.object({
  ok: v.boolean(),
  skipped: v.boolean(),
  deferred: v.boolean(),
  ingested: v.number(),
  failed: v.number(),
  error: v.optional(v.string()),
});
function sourceConfig(kind: NvdKind) {
  return kind === "cves"
    ? {
        key: "nvd-cve-2",
        name: "NVD CVE API 2.0",
        baseUrl: CVE_ENDPOINT,
        homepageUrl: NVD_HOME,
      }
    : {
        key: "nvd-cve-change-history-2",
        name: "NVD CVE Change History API 2.0",
        baseUrl: HISTORY_ENDPOINT,
        homepageUrl: "https://nvd.nist.gov/developers/vulnerabilities",
      };
}
async function saveSource(
  ctx: ActionCtx,
  kind: NvdKind,
  state: SourceState | null,
  values: {
    cursor: string;
    lastFetchedAt: number;
    lastSucceededAt: number;
    lastErrorAt: number;
    lastErrorMessage: string;
  },
) {
  const config = sourceConfig(kind);
  return await ctx.runMutation(upsertSourceRef, {
    sourceKey: config.key,
    name: config.name,
    sourceType: "api",
    ingestionEnabled: state?.ingestionEnabled ?? true,
    baseUrl: config.baseUrl,
    homepageUrl: config.homepageUrl,
    status: state?.status ?? "active",
    licenseClass: "public-domain",
    provenanceClass: "official",
    visibility: "public",
    termsUrl: NVD_TERMS_URL,
    etag: "",
    lastModified: "",
    ...values,
  });
}
async function writeCveClaim(
  ctx: ActionCtx,
  document: Normalized,
  documentVersionId: string,
  observedAt: number,
) {
  if (!document.cveId) return;
  const cve = await ctx.runMutation(upsertEntityRef, {
    entityKey: `cve:${document.cveId.toLowerCase()}`,
    kind: "concept",
    name: document.cveId,
    aliases: [],
    visibility: "public",
  });
  const nvd = await ctx.runMutation(upsertEntityRef, {
    entityKey: "organization:nvd",
    kind: "organization",
    name: "National Vulnerability Database",
    aliases: ["NVD"],
    visibility: "public",
  });
  await Promise.all([
    ctx.runMutation(linkEntityRef, {
      documentVersionId,
      entityId: cve.entityId,
      role: "subject",
    }),
    ctx.runMutation(linkEntityRef, {
      documentVersionId,
      entityId: nvd.entityId,
      role: "publisher",
    }),
  ]);
  const claim = await ctx.runMutation(upsertClaimRef, {
    claimKey: `nvd-cve:${document.cveId.toLowerCase()}`,
    statement: `${document.cveId} is published in the National Vulnerability Database.`,
    subjectEntityId: cve.entityId,
    predicate: "published-in-nvd",
    objectText: "National Vulnerability Database",
    status: "supported",
    confidence: 1,
    visibility: "public",
    observedAt,
    actorType: "system",
    actorId: "nvd-cve-2",
    source: "NVD CVE API 2.0",
  });
  await ctx.runMutation(citationRef, {
    claimId: claim.claimId,
    documentVersionId,
    citationKey: `nvd-cve:${document.cveId.toLowerCase()}:version:${documentVersionId}`,
    relation: "supports",
    locator: document.canonicalUrl,
    excerpt: document.excerpt,
    confidence: 1,
    actorType: "system",
    actorId: "nvd-cve-2",
    source: "NVD CVE API 2.0",
  });
  // The citation can have committed before an interrupted webhook enqueue;
  // replay the idempotent event key instead of treating `citation.created` as
  // proof that every dependent mutation completed.
  await ctx.runMutation(webhookRef, {
    eventKey: `claim:${claim.claimId}:version:${documentVersionId}`,
    eventType: "evidence.claim.verified",
    payloadJson: JSON.stringify({
      claimId: claim.claimId,
      documentVersionId,
      status: "supported",
      confidence: 1,
    }),
  });
}
async function sync(kind: NvdKind, ctx: ActionCtx, force = false) {
  const config = sourceConfig(kind);
  const state = await ctx.runQuery(sourceStateRef, { sourceKey: config.key });
  const now = Date.now();
  if (state && (!state.ingestionEnabled || state.status !== "active"))
    return { ok: true, skipped: true, deferred: false, ingested: 0, failed: 0 };
  const cursor = nextNvdCursor(state, now);
  if (!force && cursor.retryNotBefore && cursor.retryNotBefore > now)
    return {
      ok: false,
      skipped: true,
      deferred: true,
      ingested: 0,
      failed: 1,
      error: "NVD retry backoff is active",
    };
  try {
    const payload = await fetchNvd(buildNvdUrl(kind, cursor));
    // Validate the entire pagination contract before recording a successful
    // fetch or mutating any document. Missing counts must fail closed.
    const page = parseNvdPage(kind, cursor, payload);
    const preservedLastSucceededAt = state?.lastSucceededAt ?? 0;

    // Persist the current page before beginning document mutations. A crash or
    // partial write therefore replays this idempotent page rather than losing
    // it by clearing the cursor early.
    const source = await saveSource(
      ctx,
      kind,
      state,
      nvdInProgressCheckpoint(cursor, preservedLastSucceededAt, now),
    );
    let ingested = 0;
    for (const document of page.documents) {
      const stored = await ctx.runMutation(upsertVersionRef, {
        sourceId: source.sourceId,
        externalKey: document.externalKey,
        canonicalUrl: document.canonicalUrl,
        canonicalUrlHash: await hash(document.canonicalUrl),
        contentHash: await hash(document),
        kind: "advisory",
        visibility: "public",
        title: document.title,
        excerpt: document.excerpt,
        searchText: document.searchText,
        tags: document.tags,
        authors: document.authors,
        documentLicenseClass: "public-domain",
        fetchedAt: now,
        publishedAt: document.publishedAt,
        sourceRevision: document.sourceRevision,
        sourceUpdatedAt: document.sourceUpdatedAt || now,
        retrievalUrl: document.canonicalUrl,
        licenseClass: "public-domain",
        metadataJson: stableJson(document.metadata).slice(0, 4_000),
      });
      const postVersionWork = nvdPostVersionWork(kind, stored.idempotent);
      if (postVersionWork.writeCveClaim)
        await writeCveClaim(ctx, document, stored.versionId, now);
      if (postVersionWork.enqueueDocumentEvent) {
        await ctx.runMutation(webhookRef, {
          eventKey: `document:${stored.documentId}:version:${stored.version}`,
          eventType: "evidence.document.changed",
          payloadJson: JSON.stringify({
            documentId: stored.documentId,
            documentVersionId: stored.versionId,
            version: stored.version,
            kind: "advisory",
            canonicalUrl: document.canonicalUrl,
            changedFields: stored.changedFields,
          }),
        });
      }
      ingested += 1;
    }
    await saveSource(
      ctx,
      kind,
      state,
      nvdSuccessCheckpoint(page.nextCursor, now),
    );
    return {
      ok: true,
      skipped: false,
      deferred: false,
      ingested,
      failed: 0,
    };
  } catch (error) {
    const typed = error as Error & { status?: number; retryAfter?: number };
    const retryCursor = nvdRetryCursor(cursor, typed, now);
    const diagnostic =
      error instanceof NvdPaginationError
        ? `; diagnostic=${JSON.stringify(error.diagnostic)}`
        : "";
    const message =
      text(`${typed.message || "NVD ingestion failed"}${diagnostic}`, 500) ||
      "NVD ingestion failed";
    await saveSource(ctx, kind, state, {
      ...nvdFailureCheckpoint(
        cursor,
        state?.lastSucceededAt ?? 0,
        now,
        message,
      ),
      cursor: JSON.stringify(retryCursor),
    });
    await ctx.runMutation(logRef, {
      level: "error",
      source: "convex",
      scope: "evidence-ingestion",
      eventType: "upstream_fetch_failed",
      message,
      component: "evidenceNvd",
      action: config.key,
      fingerprint: `evidence-nvd:${config.key}:${typed.status ?? "network"}:${message}`,
    });
    return {
      ok: false,
      skipped: false,
      deferred: false,
      ingested: 0,
      failed: 1,
      error: message,
    };
  }
}

/** Incremental, recent-only NVD CVE sync. Historical backfill is intentionally not scheduled. */
export const syncCves = internalAction({
  args: { force: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => sync("cves", ctx, args.force ?? false),
});
/** Immutable NVD change events; unchanged CVEs are never re-written by this feed. */
export const syncChangeHistory = internalAction({
  args: { force: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args) => sync("history", ctx, args.force ?? false),
});
