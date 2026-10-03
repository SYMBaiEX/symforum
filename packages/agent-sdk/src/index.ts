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

export type Page<T> = { items: T[]; nextCursor?: string | null };
export type ArtifactMetadata = {
  sha256?: string;
  byteLength?: number;
  contentType?: string;
  generatedAt?: number;
  expiresAt?: number;
};
export type ExportManifest = JsonObject & {
  checksum?: string;
  sha256?: string;
  recordCount?: number;
  artifactByteLength?: number;
};
export type BatchReadOperation = {
  id: string;
  method?: "GET";
  path: `/v1/${string}`;
};
export type BatchReadResult<T = unknown> = {
  id: string;
  status: number;
  body: T;
};

export type WaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type WebhookVerificationInput = {
  secret: string;
  timestamp: string;
  signature: string;
  body: string | Uint8Array;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

export type EvidenceDataset = {
  datasetId: string;
  datasetKey: string;
  name: string;
  description: string;
  licenseClass: string;
  exportSchemaVersion: string;
  selection: {
    includedKinds: string[];
    includedLicenseClasses: string[];
    sourceKeys: string[];
  };
  latestVersion: null | {
    datasetVersionId: string;
    version: string;
    checksum: string;
    recordCount: number;
    schemaVersion: string;
    artifactByteLength: number;
    sourceCount: number;
    configuredSourceCount: number;
    sourceCoverageScore: number;
    missingSourceKeys: string[];
    citationCount: number;
    citationCoverageScore: number;
    entityCount: number;
    entityCoverageScore: number;
    claimCount: number;
    claimCoverageScore: number;
    completenessScore: number;
    freshnessScore: number;
    earliestObservedAt: number | null;
    latestObservedAt: number | null;
    createdAt: number;
  };
};

export type EvidenceDocument = {
  documentId: string;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  kind: string;
  licenseClass: string;
  tags: string[];
  authors: string[];
  publishedAt: number | null;
  firstSeenAt: number;
  updatedAt: number;
  source: {
    sourceKey: string;
    name: string;
    homepageUrl: string;
    termsUrl: string;
    provenanceClass: string;
    licenseClass: string;
  };
  currentVersion: null | {
    documentVersionId: string;
    version: number;
    contentHash: string;
    fetchedAt: number;
    sourceRevision: string;
    sourceUpdatedAt: number;
    retrievalUrl: string;
    licenseClass: string;
  };
  citationMetrics: {
    total: number;
    supports: number;
    contradicts: number;
    context: number;
    truncated: boolean;
  };
};

export type WebhookEventType =
  | "evidence.document.changed"
  | "evidence.research.completed"
  | "evidence.export.completed"
  | "evidence.benchmark.completed"
  | "evidence.claim.verified"
  | "evidence.usage.threshold_reached"
  | "evidence.usage.budget_reached"
  | "evidence.entitlement.status_changed";

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
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

/** Verifies the AsyncAPI v1 HMAC signature before a webhook body is trusted. */
export async function verifyWebhookSignature(
  input: WebhookVerificationInput,
): Promise<boolean> {
  if (
    !/^(0|[1-9][0-9]*)$/.test(input.timestamp) ||
    !/^v1=[a-f0-9]{64}$/.test(input.signature)
  )
    return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const tolerance = input.toleranceSeconds ?? 300;
  const timestamp = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isSafeInteger(tolerance) ||
    tolerance < 0 ||
    Math.abs(now - timestamp) > tolerance
  )
    return false;
  const encoder = new TextEncoder();
  const body =
    typeof input.body === "string" ? encoder.encode(input.body) : input.body;
  const signed = new Uint8Array(
    encoder.encode(`${input.timestamp}.`).byteLength + body.byteLength,
  );
  signed.set(encoder.encode(`${input.timestamp}.`));
  signed.set(body, encoder.encode(`${input.timestamp}.`).byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, signed),
  );
  const received = hexBytes(input.signature.slice(3));
  if (!received || received.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < expected.byteLength; index += 1)
    difference |= expected[index]! ^ received[index]!;
  return difference === 0;
}

export type AgentClientOptions = {
  origin?: string;
  /** Required when overriding the platform origin. Exact origins only. */
  trustedOrigins?: readonly string[];
  fetch?: FetchLike;
  tokenStore?: TokenStore;
  signer?: RequestSigner;
  /** Maximum time for JSON requests before a sanitized timeout error. */
  requestTimeoutMs?: number;
  /** Maximum time for bounded artifact downloads. */
  artifactTimeoutMs?: number;
};

export class AgentClient {
  private readonly origin: string;
  private readonly fetcher: FetchLike;
  private readonly tokenStore?: TokenStore;
  private readonly requestTimeoutMs: number;
  private readonly artifactTimeoutMs: number;
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
    this.requestTimeoutMs = validTimeout(
      options.requestTimeoutMs ?? 15_000,
      "requestTimeoutMs",
    );
    this.artifactTimeoutMs = validTimeout(
      options.artifactTimeoutMs ?? 60_000,
      "artifactTimeoutMs",
    );
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

  async document<T = EvidenceDocument | null>(documentId: string): Promise<T> {
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

  async datasets<T = EvidenceDataset[]>(limit?: number): Promise<T> {
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

  async batch<T = unknown>(
    operations: readonly BatchReadOperation[],
  ): Promise<{ results: BatchReadResult<T>[] }> {
    if (operations.length < 1 || operations.length > 10) {
      throw new TypeError("batch requires between 1 and 10 operations");
    }
    const ids = new Set<string>();
    const bounded = operations.map((operation) => {
      const id = validIdentifier(operation.id, "batch operation id", 80);
      if (ids.has(id))
        throw new TypeError("batch operation ids must be unique");
      ids.add(id);
      if (operation.method !== undefined && operation.method !== "GET") {
        throw new TypeError("batch supports GET operations only");
      }
      if (
        typeof operation.path !== "string" ||
        !operation.path.startsWith("/v1/") ||
        operation.path.includes("#") ||
        operation.path.length > 2_000
      ) {
        throw new TypeError("batch paths must be bounded /v1/ read paths");
      }
      return { id, method: "GET" as const, path: operation.path };
    });
    return await this.request<{ results: BatchReadResult<T>[] }>(
      "/api/agent/v1/batch",
      { method: "POST", body: { operations: bounded } },
    );
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

  async datasetVersions<T = unknown>(
    datasetId: string,
    limit = 20,
    cursor?: string,
  ): Promise<T> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) params.set("cursor", cursor);
    return await this.get<T>(
      `datasets/${encodePathSegment(datasetId)}/versions?${params}`,
    );
  }

  async datasetVersionDiff<T = unknown>(
    datasetId: string,
    versionId: string,
    againstVersionId?: string,
  ): Promise<T> {
    const suffix = againstVersionId
      ? `?against=${encodeURIComponent(againstVersionId)}`
      : "";
    return await this.get<T>(
      `datasets/${encodePathSegment(datasetId)}/versions/${encodePathSegment(versionId)}/diff${suffix}`,
    );
  }

  async datasetVersionArtifact(
    datasetId: string,
    versionId: string,
  ): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/datasets/${encodePathSegment(datasetId)}/versions/${encodePathSegment(versionId)}/artifact`,
    );
  }

  async datasetVersionManifest(
    datasetId: string,
    versionId: string,
  ): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/datasets/${encodePathSegment(datasetId)}/versions/${encodePathSegment(versionId)}/manifest`,
    );
  }

  async researchJob<T = unknown>(jobId: string): Promise<T> {
    return await this.get<T>(`research-jobs/${encodePathSegment(jobId)}`);
  }

  async researchArtifact(jobId: string): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/research-jobs/${encodePathSegment(jobId)}/artifact`,
    );
  }

  async waitForResearch<T extends ResearchJob = ResearchJob>(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<T> {
    return await this.waitForJob<T>(
      jobId,
      (id) => this.researchJob<T>(id),
      options,
    );
  }

  async createExport(
    datasetId: string,
    idempotencyKey: string,
    recordLimit?: number,
    format: "jsonl" | "parquet" = "jsonl",
    selectionStrategy: "balanced" | "recent" = "balanced",
    cursor?: string,
  ): Promise<ExportJob> {
    if (
      recordLimit !== undefined &&
      (!Number.isSafeInteger(recordLimit) ||
        recordLimit < 1 ||
        recordLimit > 500)
    )
      throw new TypeError("recordLimit must be an integer between 1 and 500");
    if (cursor !== undefined && (!cursor || cursor.length > 512))
      throw new TypeError("cursor must be between 1 and 512 characters");
    return await this.request<ExportJob>("/api/agent/v1/exports", {
      method: "POST",
      body: {
        datasetId: validIdentifier(datasetId, "datasetId", 512),
        format,
        ...(recordLimit === undefined ? {} : { recordLimit }),
        selectionStrategy,
        ...(cursor === undefined ? {} : { cursor }),
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

  async exportManifest(jobId: string): Promise<Uint8Array> {
    return await this.requestBytes(
      `/api/agent/v1/exports/${encodePathSegment(jobId)}/manifest`,
    );
  }

  async waitForExport<T extends ExportJob = ExportJob>(
    jobId: string,
    options: WaitOptions = {},
  ): Promise<T> {
    return await this.waitForJob<T>(
      jobId,
      (id) => this.exportJob<T>(id),
      options,
    );
  }

  async verifyExportManifest(
    jobId: string,
    artifact?: Uint8Array,
  ): Promise<ExportManifest> {
    const bytes = await this.exportManifest(jobId);
    let manifest: ExportManifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(bytes)) as ExportManifest;
    } catch {
      throw new AgentApiError(
        200,
        "INVALID_MANIFEST",
        "The export manifest is invalid.",
      );
    }
    if (!artifact) return manifest;
    const expected = manifest.sha256 ?? manifest.checksum;
    if (typeof expected !== "string" || !/^[a-fA-F0-9]{64}$/.test(expected))
      throw new AgentApiError(
        200,
        "INVALID_MANIFEST",
        "The export manifest has no valid SHA-256 checksum.",
      );
    const actual = await sha256Hex(artifact);
    if (actual !== expected.toLowerCase())
      throw new AgentApiError(
        200,
        "CHECKSUM_MISMATCH",
        "The export artifact checksum does not match its manifest.",
      );
    if (
      typeof manifest.artifactByteLength === "number" &&
      manifest.artifactByteLength !== artifact.byteLength
    )
      throw new AgentApiError(
        200,
        "ARTIFACT_SIZE_MISMATCH",
        "The export artifact size does not match its manifest.",
      );
    return manifest;
  }

  async *paginate<T>(
    path: string,
    options: { limit?: number; cursor?: string } = {},
  ): AsyncGenerator<T, void, void> {
    let cursor = options.cursor;
    do {
      const params = new URLSearchParams();
      if (options.limit !== undefined)
        params.set("limit", String(validLimit(options.limit)));
      if (cursor) params.set("cursor", validIdentifier(cursor, "cursor", 512));
      const page = await this.request<Page<T>>(
        `${path}${params.size ? `?${params}` : ""}`,
      );
      if (!Array.isArray(page.items))
        throw new AgentApiError(
          502,
          "INVALID_RESPONSE",
          "The platform returned an invalid pagination response.",
        );
      for (const item of page.items) yield item;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
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
      protocolVersion?: "2026-07-28" | "2025-06-18" | "2025-03-26";
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

  private async waitForJob<T extends ResearchJob>(
    jobId: string,
    read: (jobId: string) => Promise<T>,
    options: WaitOptions,
  ): Promise<T> {
    const timeoutMs = validWaitTimeout(options.timeoutMs ?? 60_000);
    const pollIntervalMs = validWaitInterval(options.pollIntervalMs ?? 1_000);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (options.signal?.aborted)
        throw new AgentApiError(
          408,
          "REQUEST_ABORTED",
          "Waiting for the job was aborted.",
        );
      const job = await read(jobId);
      if (["completed", "failed", "cancelled", "expired"].includes(job.status))
        return job;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new AgentApiError(
          408,
          "WAIT_TIMEOUT",
          "Waiting for the job timed out.",
        );
      await delay(Math.min(pollIntervalMs, remaining), options.signal);
    }
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
    return await this.withTimeout(this.requestTimeoutMs, async (signal) => {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      const payload = await readJson(response);
      if (!response.ok)
        throw toApiError(
          response.status,
          payload,
          token ?? undefined,
          response.headers.get("retry-after"),
        );
      return payload as T;
    });
  }

  private async requestBytes(path: string): Promise<Uint8Array> {
    const token = await this.tokenStore?.getToken();
    if (!token)
      throw new AgentApiError(
        401,
        "AUTH_REQUIRED",
        "An agent access token is required.",
      );
    return await this.withTimeout(this.artifactTimeoutMs, async (signal) => {
      const response = await this.fetcher(new URL(path, this.origin), {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/octet-stream",
        },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw toApiError(
          response.status,
          await readJson(response),
          token,
          response.headers.get("retry-after"),
        );
      assertResponseSize(response, 10 * 1024 * 1024);
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength > 10 * 1024 * 1024)
        throw new AgentApiError(
          response.status,
          "RESPONSE_TOO_LARGE",
          "The platform response exceeded the client safety limit.",
        );
      return body;
    });
  }

  private async withTimeout<T>(
    timeoutMs: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await work(controller.signal);
    } catch (error) {
      if (error instanceof AgentApiError) throw error;
      if (controller.signal.aborted) {
        throw new AgentApiError(
          408,
          "REQUEST_TIMEOUT",
          "The platform request timed out.",
        );
      }
      throw new AgentApiError(
        0,
        "NETWORK_ERROR",
        "The platform request could not be completed.",
      );
    } finally {
      clearTimeout(timeout);
    }
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

function validTimeout(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000)
    throw new TypeError(`${label} must be an integer between 1 and 120000.`);
  return value;
}

function validWaitTimeout(value: number) {
  return validTimeout(value, "timeoutMs");
}
function validWaitInterval(value: number) {
  if (!Number.isSafeInteger(value) || value < 50 || value > 30_000)
    throw new TypeError(
      "pollIntervalMs must be an integer between 50 and 30000.",
    );
  return value;
}

async function delay(milliseconds: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(
          new AgentApiError(
            408,
            "REQUEST_ABORTED",
            "Waiting for the job was aborted.",
          ),
        );
      },
      { once: true },
    );
  });
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexBytes(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
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
  if (!(
    (url.protocol === "https:" && production) ||
    (url.protocol === "http:" && local)
  ))
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

function toApiError(
  status: number,
  payload: unknown,
  token?: string,
  retryAfter?: string | null,
) {
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
  return new AgentApiError(
    status,
    code,
    "The platform request failed.",
    parseRetryAfter(retryAfter),
  );
}

function parseRetryAfter(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0
    ? seconds * 1_000
    : undefined;
}
