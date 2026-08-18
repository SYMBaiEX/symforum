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
  endpoints: { quota: string; evidenceRest: string };
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

  async createResearch(
    query: string,
    idempotencyKey = crypto.randomUUID(),
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

  async signLoginMessage(message: string): Promise<string> {
    if (!this.signer)
      throw new TypeError("A signer is required for an agent login message.");
    return await this.signer.sign(message);
  }

  private async request<T>(
    path: string,
    options: {
      authenticated?: boolean;
      method?: "GET" | "POST";
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (options.authenticated !== false) {
      const token = await this.tokenStore?.getToken();
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
    if (!response.ok) throw toApiError(response.status, payload);
    return payload as T;
  }
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    throw new TypeError("platform origin must use HTTPS");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
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
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentApiError(
      response.status,
      "INVALID_RESPONSE",
      "The platform returned invalid JSON.",
    );
  }
}

function toApiError(status: number, payload: unknown) {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const message =
    typeof record.error === "string"
      ? record.error
      : "The platform request failed.";
  const code = typeof record.code === "string" ? record.code : `HTTP_${status}`;
  return new AgentApiError(status, code, message);
}
