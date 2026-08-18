/** A dependency-light client for the public SYMBaiEX agent API. */

export const DEFAULT_PLATFORM_ORIGIN = "https://www.symbaiex.com";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TokenStore = {
  getToken(): Promise<string | null>;
  setToken?(token: string): Promise<void>;
};

export type RequestSigner = {
  sign(message: string): Promise<string>;
};

export type AgentManifest = {
  name: string;
  version: string;
  baseUrl: string;
  scopes: string[];
  endpoints: {
    quota: string;
    evidenceRest: string;
    sourceRegistry?: string;
    semanticSearch?: string;
  };
};

export type AgentQuota = {
  agentId: string;
  monthKey: string;
  usedUnits: number;
  remainingUnits: number;
  agentUsedUnits: number;
  agentRemainingUnits: number;
};

export type ResearchJob = {
  jobId: string;
  status: string;
};

export type ExportJob = ResearchJob;
export type JsonObject = Record<string, unknown>;
export type McpPayload = JsonObject;

export type WebhookEventType =
  | "evidence.document.changed"
  | "evidence.research.completed"
  | "evidence.export.completed"
  | "evidence.benchmark.completed"
  | "evidence.claim.verified";

export type WebhookSubscription = {
  subscriptionKey: string;
  url: string;
  status: "active" | "paused" | "revoked";
  eventTypes: WebhookEventType[];
  createdAt: number;
  updatedAt: number;
  /** Present only in the response that creates or rotates a secret. */
  signingSecret?: string;
};

export type WebhookDelivery = {
  eventKey: string;
  status: "pending" | "in_flight" | "delivered" | "failed" | "dead_letter";
  attempt: number;
  responseCode?: number;
  nextAttemptAt?: number;
  createdAt: number;
  updatedAt: number;
};

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export type AgentClientOptions = {
  origin?: string;
  /** Required when overriding the platform origin. Exact origins only. */
  trustedOrigins?: readonly string[];
  fetch?: FetchLike;
  tokenStore?: TokenStore;
  signer?: RequestSigner;
};

export class AgentClient {
  private readonly origin: string;
  private readonly fetcher: FetchLike;
  private readonly tokenStore?: TokenStore;
  readonly signer?: RequestSigner;

  constructor(options: AgentClientOptions = {}) {
    const requestedOrigin = normalizeOrigin(
      options.origin ?? DEFAULT_PLATFORM_ORIGIN,
    );
    this.origin = assertTrustedOrigin(
      requestedOrigin,
      options.origin === undefined
        ? [DEFAULT_PLATFORM_ORIGIN]
        : options.trustedOrigins,
    );
    this.fetcher = options.fetch ?? fetch;
    this.tokenStore = options.tokenStore;
    this.signer = options.signer;
  }

  async manifest(): Promise<AgentManifest> {
    return await this.request<AgentManifest>("/api/agent", {
      authenticated: false,
    });
  }

  async status<T = unknown>(): Promise<T> {
    return await this.request<T>("/api/agent/v1/status");
  }

  async quota(): Promise<AgentQuota> {
    return await this.request<AgentQuota>("/api/agent/quota");
  }

  async challenge(agentId: string): Promise<JsonObject> {
    return await this.request<JsonObject>("/api/agent/auth/challenge", {
      authenticated: false,
      method: "POST",
      body: { agentId: validIdentifier(agentId, "agentId", 64) },
    });
  }

  async signIn(
    agentId: string,
    challenge: string,
    signature: string,
    audience?: string,
  ): Promise<JsonObject> {
    return await this.request<JsonObject>("/api/agent/auth/sign-in", {
      authenticated: false,
      method: "POST",
      body: {
        agentId: validIdentifier(agentId, "agentId", 64),
        challenge: validIdentifier(challenge, "challenge", 8192),
        signature: validIdentifier(signature, "signature", 8192),
        ...(audience === undefined
          ? {}
          : { audience: validIdentifier(audience, "audience", 2048) }),
      },
    });
  }

  async refresh(refreshToken: string): Promise<JsonObject> {
    return await this.request<JsonObject>("/api/agent/auth/refresh", {
      authenticated: false,
      method: "POST",
      body: {
        refreshToken: validIdentifier(refreshToken, "refreshToken", 8192),
      },
    });
  }

  async search<T = unknown>(query: string, limit?: number): Promise<T> {
    const text = query.trim();
    if (!text) throw new TypeError("search query must not be empty");
    const params = new URLSearchParams({ q: text });
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new TypeError("limit must be a positive integer");
      params.set("limit", String(limit));
    }
    return await this.request<T>(`/api/agent/v1/search?${params}`);
  }

  async sources<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("sources", limit);
  }

  async sourceRegistry<T = unknown>(): Promise<T> {
    return await this.get<T>("source-registry");
  }

  async universalSearch<T = unknown>(
    query: string,
    limit?: number,
  ): Promise<T> {
    const text = query.trim();
    if (!text) throw new TypeError("universal search query must not be empty");
    const params = new URLSearchParams({ q: text });
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw new TypeError("limit must be an integer between 1 and 50");
      params.set("limit", String(limit));
    }
    return await this.request<T>(`/api/agent/v1/universal-search?${params}`);
  }

  async semanticSearch<T = unknown>(
    query: string,
    options: { limit?: number; idempotencyKey?: string } = {},
  ): Promise<T> {
    const text = query.trim();
    if (!text || text.length > 300)
      throw new TypeError("semantic search query must be 1-300 characters");
    const limit = options.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new TypeError("limit must be an integer between 1 and 20");
    const idempotencyKey = validSemanticIdempotencyKey(
      options.idempotencyKey ?? crypto.randomUUID(),
    );
    const params = new URLSearchParams({ q: text, limit: String(limit) });
    return await this.request<T>(`/api/agent/v1/semantic-search?${params}`, {
      idempotencyKey,
    });
  }

  async document<T = unknown>(documentId: string): Promise<T> {
    return await this.get<T>(`documents/${encodePathSegment(documentId)}`);
  }

  async changes<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("changes", limit);
  }

  async verifyClaim<T = unknown>(
    claimId: string,
    idempotencyKey: string,
  ): Promise<T> {
    return await this.request<T>(
      `/api/agent/v1/claims/${encodePathSegment(claimId)}/verify`,
      { method: "POST", idempotencyKey: validIdempotencyKey(idempotencyKey) },
    );
  }

  async entities<T = unknown>(query: string, limit?: number): Promise<T> {
    return await this.searchResource<T>("entities", query, limit);
  }

  async versionClaims<T = unknown>(
    documentVersionId: string,
    limit?: number,
  ): Promise<T> {
    return await this.get<T>(
      `document-versions/${encodePathSegment(documentVersionId)}/claims`,
      limit,
    );
  }

  async claimTimeline<T = unknown>(
    claimKey: string,
    limit?: number,
  ): Promise<T> {
    return await this.get<T>(
      `claims/${encodePathSegment(validIdentifier(claimKey, "claimKey", 200))}/timeline`,
      limit,
    );
  }

  async products<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("products", limit);
  }

  async datasets<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("datasets", limit);
  }

  async benchmarks<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("benchmarks", limit);
  }

  async entitlements<T = unknown>(): Promise<T> {
    return await this.get<T>("entitlements");
  }

  async usage<T = unknown>(limit?: number): Promise<T> {
    return await this.get<T>("usage", limit);
  }

  async createResearch(
    query: string,
    idempotencyKey: string,
  ): Promise<ResearchJob> {
    const text = query.trim();
    if (!text) throw new TypeError("research query must not be empty");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(idempotencyKey)) {
      throw new TypeError(
        "idempotencyKey must be 1-160 safe identifier characters",
      );
    }
    return await this.request<ResearchJob>("/api/agent/v1/research-jobs", {
      method: "POST",
      body: { query: text },
      idempotencyKey,
    });
  }

  async researchJob<T = unknown>(jobId: string): Promise<T> {
    return await this.get<T>(`research-jobs/${encodePathSegment(jobId)}`);
  }

  async researchArtifact(jobId: string): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/research-jobs/${encodePathSegment(jobId)}/artifact`,
    );
  }

  async createExport(
    datasetId: string,
    idempotencyKey: string,
  ): Promise<ExportJob> {
    return await this.request<ExportJob>("/api/agent/v1/exports", {
      method: "POST",
      body: {
        datasetId: validIdentifier(datasetId, "datasetId", 512),
        format: "jsonl",
      },
      idempotencyKey: validIdempotencyKey(idempotencyKey),
    });
  }

  async exportJob<T = unknown>(jobId: string): Promise<T> {
    return await this.get<T>(`exports/${encodePathSegment(jobId)}`);
  }

  async exportArtifact(jobId: string): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/exports/${encodePathSegment(jobId)}/artifact`,
    );
  }

  async webhookAvailability(): Promise<{ enabled: boolean }> {
    return await this.request("/api/agent/v1/webhooks/availability");
  }

  async listWebhooks(): Promise<WebhookSubscription[]> {
    return await this.request("/api/agent/v1/webhooks");
  }

  async createWebhook(
    subscriptionKey: string,
    url: string,
    eventTypes: readonly WebhookEventType[],
    idempotencyKey: string,
  ): Promise<WebhookSubscription> {
    return await this.request("/api/agent/v1/webhooks", {
      method: "POST",
      body: { subscriptionKey, url, eventTypes },
      idempotencyKey: validIdempotencyKey(idempotencyKey),
    });
  }

  async setWebhookStatus(
    subscriptionKey: string,
    status: "active" | "paused" | "revoked",
    idempotencyKey: string,
  ): Promise<WebhookSubscription> {
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/status`,
      {
        method: "POST",
        body: { status },
        idempotencyKey: validIdempotencyKey(idempotencyKey),
      },
    );
  }

  async webhookHealth(subscriptionKey: string): Promise<{
    delivered: number;
    failed: number;
    deadLetter: number;
    pending: number;
  }> {
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/health`,
    );
  }

  async webhookHistory(
    subscriptionKey: string,
    limit?: number,
  ): Promise<WebhookDelivery[]> {
    const params = limit === undefined ? "" : `?limit=${validLimit(limit)}`;
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/deliveries${params}`,
    );
  }

  /** The returned secret is shown exactly once; store it outside model context. */
  async rotateWebhookSecret(
    subscriptionKey: string,
    idempotencyKey: string,
  ): Promise<WebhookSubscription> {
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/rotate`,
      {
        method: "POST",
        body: {},
        idempotencyKey: validIdempotencyKey(idempotencyKey),
      },
    );
  }

  async replayWebhookDelivery(
    subscriptionKey: string,
    eventKey: string,
    idempotencyKey: string,
  ): Promise<WebhookDelivery> {
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/deliveries/${encodePathSegment(eventKey)}/replay`,
      {
        method: "POST",
        body: {},
        idempotencyKey: validIdempotencyKey(idempotencyKey),
      },
    );
  }

  async sendWebhookTest(
    subscriptionKey: string,
    eventType: WebhookEventType,
    idempotencyKey: string,
  ): Promise<WebhookDelivery> {
    return await this.request(
      `/api/agent/v1/webhooks/${encodePathSegment(subscriptionKey)}/test`,
      {
        method: "POST",
        body: { eventType },
        idempotencyKey: validIdempotencyKey(idempotencyKey),
      },
    );
  }

  async signLoginMessage(message: string): Promise<string> {
    if (!this.signer)
      throw new TypeError("A signer is required for an agent login message.");
    return await this.signer.sign(message);
  }

  async mcp<T = unknown>(
    payload: McpPayload,
    options: {
      protocolVersion?: "2026-07-28" | "2025-03-26";
      method?: string;
      name?: string;
    } = {},
  ): Promise<T> {
    const protocolVersion = options.protocolVersion ?? "2026-07-28";
    return await this.request<T>("/api/agent/mcp", {
      method: "POST",
      body: payload,
      headers: {
        "mcp-protocol-version": protocolVersion,
        ...(options.method === undefined
          ? {}
          : { "mcp-method": validIdentifier(options.method, "method", 200) }),
        ...(options.name === undefined
          ? {}
          : { "mcp-name": validIdentifier(options.name, "name", 200) }),
      },
    });
  }

  private async get<T>(resource: string, limit?: number): Promise<T> {
    const query = limit === undefined ? "" : `?limit=${validLimit(limit)}`;
    return await this.request<T>(`/api/agent/v1/${resource}${query}`);
  }

  private async searchResource<T>(
    resource: string,
    query: string,
    limit?: number,
  ): Promise<T> {
    const text = query.trim();
    if (!text) throw new TypeError("search query must not be empty");
    const params = new URLSearchParams({ q: text });
    if (limit !== undefined) params.set("limit", String(validLimit(limit)));
    return await this.request<T>(`/api/agent/v1/${resource}?${params}`);
  }

  private async request<T>(
    path: string,
    options: {
      authenticated?: boolean;
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }
    let token: string | null | undefined;
    if (options.authenticated !== false) {
      token = await this.tokenStore?.getToken();
      if (!token)
        throw new AgentApiError(
          401,
          "AUTH_REQUIRED",
          "An agent access token is required.",
        );
      headers.set("authorization", `Bearer ${token}`);
    }
    if (options.idempotencyKey)
      headers.set("idempotency-key", options.idempotencyKey);
    if (options.body !== undefined)
      headers.set("content-type", "application/json");
    const response = await this.fetcher(new URL(path, this.origin), {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
    });
    const payload = await readJson(response);
    if (!response.ok)
      throw toApiError(response.status, payload, token ?? undefined);
    return payload as T;
  }

  private async requestBytes(path: string): Promise<Uint8Array> {
    const token = await this.tokenStore?.getToken();
    if (!token)
      throw new AgentApiError(
        401,
        "AUTH_REQUIRED",
        "An agent access token is required.",
      );
    const response = await this.fetcher(new URL(path, this.origin), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/octet-stream",
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok)
      throw toApiError(response.status, await readJson(response), token);
    assertResponseSize(response, 10 * 1024 * 1024);
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > 10 * 1024 * 1024)
      throw new AgentApiError(
        response.status,
        "RESPONSE_TOO_LARGE",
        "The platform response exceeded the client safety limit.",
      );
    return body;
  }
}

function encodePathSegment(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512)
    throw new TypeError("identifier must be a bounded non-empty string");
  return encodeURIComponent(normalized);
}

function validIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value))
    throw new TypeError(
      "idempotencyKey must be 1-160 safe identifier characters",
    );
  return value;
}

function validSemanticIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/.test(value)) {
    throw new TypeError(
      "idempotencyKey must be 8-96 safe identifier characters",
    );
  }
  return value;
}

function validLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50)
    throw new TypeError("limit must be an integer between 1 and 50");
  return value;
}

function validIdentifier(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /\s/.test(normalized))
    throw new TypeError(`${label} must be a bounded non-empty string`);
  return normalized;
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      "platform origin must be an origin without a path, query, or credentials",
    );
  const production = ["symbaiex.com", "www.symbaiex.com"].includes(
    url.hostname,
  );
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    !(
      (url.protocol === "https:" && production) ||
      (url.protocol === "http:" && local)
    )
  )
    throw new TypeError(
      "platform origin must use HTTPS or a localhost development origin",
    );
  url.pathname = "";
  return url.toString();
}

function assertTrustedOrigin(
  origin: string,
  trustedOrigins: readonly string[] | undefined,
) {
  if (!trustedOrigins || trustedOrigins.length === 0) {
    throw new TypeError(
      "trustedOrigins is required when overriding the platform origin",
    );
  }
  const trusted = trustedOrigins.map(normalizeOrigin);
  if (!trusted.includes(origin)) {
    throw new TypeError("platform origin is not in trustedOrigins");
  }
  return origin;
}

async function readJson(response: Response): Promise<unknown> {
  assertResponseSize(response, 2 * 1024 * 1024);
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > 2 * 1024 * 1024)
    throw new AgentApiError(
      response.status,
      "RESPONSE_TOO_LARGE",
      "The platform response exceeded the client safety limit.",
    );
  if (!body.byteLength) return {};
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new AgentApiError(
      response.status,
      "INVALID_RESPONSE",
      "The platform returned invalid JSON.",
    );
  }
}

function assertResponseSize(response: Response, maximum: number) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maximum)
    throw new AgentApiError(
      response.status,
      "RESPONSE_TOO_LARGE",
      "The platform response exceeded the client safety limit.",
    );
}

function toApiError(status: number, payload: unknown, token?: string) {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const candidate = typeof record.code === "string" ? record.code : "";
  const code =
    /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(candidate) &&
    (!token || !candidate.toLowerCase().includes(token.toLowerCase()))
      ? candidate
      : `HTTP_${status}`;
  return new AgentApiError(status, code, "The platform request failed.");
}
