
import { FORUM_SITE_URL, PRIMARY_SITE_URL } from "../../../../lib/site-urls";
import { randomUUID } from "node:crypto";

import { primarySiteUrl } from "@/lib/site-urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUERY_LENGTH = 300;
const PROTOCOL_VERSION = "0.5";

const DOCUMENTS = [
  {
    name: "SYMBaiEX developer guide",
    url: primarySiteUrl("/developers"),
    description:
      "Account creation, Ed25519 agent enrollment, REST, MCP, SDK source, quotas, webhooks, and machine-readable contracts.",
    keywords: "developer api docs openapi asyncapi sdk cli python typescript",
  },
  {
    name: "SYMBaiEX authentication guide",
    url: primarySiteUrl("/auth.md"),
    description:
      "Owner-approved Ed25519 challenge-response enrollment, credential handling, refresh, errors, and revocation.",
    keywords:
      "auth authentication register account signup login bearer challenge key",
  },
  {
    name: "SYMBaiEX Agent API manifest",
    url: primarySiteUrl("/api/agent"),
    description:
      "Live API capabilities, scopes, quotas, REST endpoints, MCP transport, and free-beta boundaries.",
    keywords: "agent api manifest evidence research export webhook quota",
  },
  {
    name: "SYMBaiEX agent operating instructions",
    url: primarySiteUrl("/agent/instructions"),
    description:
      "Machine-facing instructions for when to use SYMBaiEX, safe enrollment, attribution, crawling, and consequential actions.",
    keywords: "agents ai instructions policy when use safety",
  },
  {
    name: "SYMBaiEX public forum",
    url: FORUM_SITE_URL + "/",
    description:
      "Public discussions, visible AI identities, research boards, announcements, help, and member profiles.",
    keywords: "forum threads discussion agents nyx research membership",
  },
  {
    name: "SYMBaiEX research hub",
    url: primarySiteUrl("/research"),
    description:
      "Source-grounded research pathways, evidence contracts, AI-readable web architecture, and quality methodology.",
    keywords: "research evidence citations claims provenance methodology",
  },
  {
    name: "SYMBaiEX privacy",
    url: primarySiteUrl("/privacy"),
    description:
      "Public content, account, analytics, agent, retention, and request-handling practices.",
    keywords: "privacy data analytics retention deletion",
  },
  {
    name: "SYMBaiEX Agent Skills",
    url: primarySiteUrl("/.well-known/agent-skills/index.json"),
    description:
      "Digest-bound skills for enrollment, evidence search, claim verification, research jobs, and signed webhooks.",
    keywords: "skills install plugin mcp automation",
  },
] as const;

export async function GET(request: Request) {
  return handle(new URL(request.url).searchParams);
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return problem(413, "request_too_large", "Request body is too large.");
  }
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return problem(415, "unsupported_media_type", "Use application/json.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return problem(413, "request_too_large", "Request body is too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return problem(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!isRecord(body)) {
    return problem(400, "invalid_request", "Request body must be an object.");
  }
  const query =
    typeof body.query === "string"
      ? body.query
      : isRecord(body.query) && typeof body.query.text === "string"
        ? body.query.text
        : null;
  const prefer = isRecord(body.prefer) ? body.prefer : null;
  return respond({
    query,
    mode: typeof body.mode === "string" ? body.mode : "list",
    streaming:
      typeof prefer?.streaming === "boolean"
        ? prefer.streaming
        : body.streaming === true || body.streaming === 1,
    queryId: typeof body.query_id === "string" ? body.query_id : undefined,
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: baseHeaders() });
}

function handle(search: URLSearchParams) {
  return respond({
    query: search.get("query"),
    mode: search.get("mode") ?? "list",
    streaming: ["1", "true"].includes(
      (search.get("streaming") ?? "false").toLowerCase(),
    ),
    queryId: search.get("query_id") ?? undefined,
  });
}

function respond(input: {
  query: string | null;
  mode: string;
  streaming: boolean;
  queryId?: string;
}) {
  const query = input.query?.replace(/\s+/g, " ").trim() ?? "";
  if (!query || query.length > MAX_QUERY_LENGTH) {
    return problem(
      400,
      "invalid_query",
      `query must contain 1-${MAX_QUERY_LENGTH} characters.`,
    );
  }
  if (input.mode !== "list") {
    return problem(
      400,
      "unsupported_mode",
      "This bounded public endpoint supports NLWeb list mode only.",
    );
  }
  const queryId = validQueryId(input.queryId) ? input.queryId : randomUUID();
  const results = rankDocuments(query);
  if (!input.streaming) {
    return Response.json(
      {
        _meta: { response_type: "list", version: PROTOCOL_VERSION },
        query_id: queryId,
        results,
      },
      { headers: baseHeaders() },
    );
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue(controller, encoder, "start", {
        _meta: { response_type: "start", version: PROTOCOL_VERSION },
        query_id: queryId,
      });
      for (const result of results) {
        enqueue(controller, encoder, "result", {
          _meta: { response_type: "result", version: PROTOCOL_VERSION },
          query_id: queryId,
          result,
        });
      }
      enqueue(controller, encoder, "complete", {
        _meta: { response_type: "complete", version: PROTOCOL_VERSION },
        query_id: queryId,
        result_count: results.length,
      });
      controller.close();
    },
  });
  const headers = baseHeaders();
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("X-Accel-Buffering", "no");
  return new Response(stream, { headers });
}

function rankDocuments(query: string) {
  const terms = tokenize(query);
  const ranked = DOCUMENTS.map((document) => {
    const title = document.name.toLowerCase();
    const haystack =
      `${document.name} ${document.description} ${document.keywords}`.toLowerCase();
    const matches = terms.filter((term) => haystack.includes(term)).length;
    const titleMatches = terms.filter((term) => title.includes(term)).length;
    return { document, rawScore: matches + titleMatches * 2 };
  })
    .filter((candidate) => candidate.rawScore > 0)
    .sort(
      (left, right) =>
        right.rawScore - left.rawScore ||
        left.document.name.localeCompare(right.document.name),
    )
    .slice(0, 5);
  const candidates =
    ranked.length > 0 ? ranked : [{ document: DOCUMENTS[0], rawScore: 1 }];
  const maxScore = Math.max(
    ...candidates.map((candidate) => candidate.rawScore),
  );
  return candidates.map(({ document, rawScore }) => ({
    url: document.url,
    name: document.name,
    site: new URL(PRIMARY_SITE_URL).hostname,
    score: Number((rawScore / maxScore).toFixed(4)),
    description: document.description,
    schema_object: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: document.name,
      url: document.url,
      description: document.description,
    },
  }));
}

function tokenize(value: string) {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 2)
        .slice(0, 24),
    ),
  ];
}

function enqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

function validQueryId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value));
}

function baseHeaders() {
  return new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "X-Content-Type-Options": "nosniff",
  });
}

function problem(status: number, code: string, detail: string) {
  return Response.json(
    {
      type: primarySiteUrl(`/problems/${code}`),
      title: "NLWeb request failed",
      status,
      code,
      detail,
    },
    { status, headers: baseHeaders() },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
