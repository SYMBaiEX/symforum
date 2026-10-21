/** The private ElizaOS worker owns live inference; this module only adapts its
 * receipt-bearing HTTP contract to the OpenAI-compatible SDK fetch boundary. */
import {
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
  OPENROUTER_NEWSLETTER_MODEL,
} from "./ai-models";

export type ElizaRuntimeReceipt = {
  jobId: string;
  inputHash: string;
  agentSlug: string;
  stage: string;
  model: string;
  status: "completed" | "failed";
  runtimeVersion?: string;
  providerStatus?: number;
  outcomeUnknown?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  servedModel?: string;
};

export type ElizaRuntimeConfig = {
  /** HTTPS origin, without /complete. */
  url: string;
  secret: string;
  /** Durable operation claim. Must finish before any network request is sent. */
  onRequest?: (request: ElizaRuntimeRequest) => void | Promise<void>;
  onReceipt?: (receipt: ElizaRuntimeReceipt) => void | Promise<void>;
};

export type ElizaRuntimeRequest = Pick<
  ElizaRuntimeReceipt,
  "jobId" | "inputHash" | "agentSlug" | "stage" | "model"
>;

export type ElizaRuntimeContext = {
  agentSlug: string;
  stage: string;
  correlationId?: string;
};

export class ElizaRuntimeTransportError extends Error {
  readonly outcomeUnknown: boolean;
  constructor(code: string, outcomeUnknown = false) {
    super(`Eliza runtime transport failed: ${code}`);
    this.name = "ElizaRuntimeTransportError";
    this.outcomeUnknown = outcomeUnknown;
  }
}

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TRANSPORT_MS = 120_000;
const LIVE_MODELS = new Set<string>([
  ...OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
  OPENROUTER_NEWSLETTER_MODEL,
]);
const STAGE_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;
const AGENT_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
// Protocol enums only. Never propagate arbitrary provider error text.
const PROVIDER_REJECTION_CODES = new Set([
  "provider_rejected",
  "provider_rejected_parameter",
  "provider_rejected_schema",
  "provider_rejected_no_endpoints",
  "provider_rejected_price",
  "provider_rejected_account",
  "provider_rejected_model",
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted)
        throw new ElizaRuntimeTransportError("outcome_unknown", true);
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        cancel();
        throw new ElizaRuntimeTransportError("response_too_large", true);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (signal.aborted)
    throw new ElizaRuntimeTransportError("outcome_unknown", true);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function tokenCount(value: unknown) {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= 100_000_000
  );
}

function validCompletion(
  value: unknown,
  requestedModel: string,
): value is Record<string, unknown> {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 200 ||
    value.object !== "chat.completion" ||
    !Number.isSafeInteger(value.created) ||
    (value.created as number) < 0 ||
    !Array.isArray(value.choices) ||
    value.choices.length < 1 ||
    value.choices.length > 4 ||
    !object(value.usage) ||
    !tokenCount(value.usage.prompt_tokens) ||
    !tokenCount(value.usage.completion_tokens) ||
    (value.usage.total_tokens !== undefined &&
      !tokenCount(value.usage.total_tokens))
  )
    return false;
  if (
    typeof value.model !== "string" ||
    !/^[a-zA-Z0-9_~./:-]{1,160}$/.test(value.model)
  )
    return false;
  const knownAlias =
    requestedModel === "~deepseek/deepseek-v4-flash-latest" &&
    /^deepseek\/deepseek-v4-flash(?:-[a-zA-Z0-9-]{1,40})?$/.test(value.model);
  if (
    requestedModel !== "openrouter/free" &&
    value.model !== requestedModel &&
    !knownAlias
  )
    return false;
  return value.choices.every((choice) => {
    if (
      !object(choice) ||
      !Number.isSafeInteger(choice.index) ||
      !object(choice.message) ||
      choice.message.role !== "assistant"
    )
      return false;
    if (
      choice.finish_reason !== null &&
      typeof choice.finish_reason !== "string"
    )
      return false;
    const message = choice.message;
    if (message.content !== null && typeof message.content !== "string")
      return false;
    return (
      message.tool_calls === undefined ||
      (Array.isArray(message.tool_calls) &&
        message.tool_calls.length <= 20 &&
        message.tool_calls.every(
          (call) =>
            object(call) &&
            typeof call.id === "string" &&
            call.type === "function" &&
            object(call.function) &&
            typeof call.function.name === "string" &&
            typeof call.function.arguments === "string",
        ))
    );
  });
}

function isTransportError(error: unknown, depth = 0): boolean {
  if (error instanceof ElizaRuntimeTransportError) return true;
  if (depth > 5 || !object(error)) return false;
  return (
    isTransportError(error.cause, depth + 1) ||
    (Array.isArray(error.errors) &&
      error.errors.some((nested) => isTransportError(nested, depth + 1)))
  );
}

export { isTransportError as isElizaRuntimeTransportError };

/** Bound, authenticate and validate one actual SDK HTTP attempt. No retries. */
export function elizaRuntimeFetch(
  config: ElizaRuntimeConfig,
  context: ElizaRuntimeContext,
): typeof fetch {
  let origin: URL;
  try {
    origin = new URL(config.url);
  } catch {
    throw new ElizaRuntimeTransportError("invalid_configuration");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    config.secret.length < 32 ||
    config.secret.length > 512 ||
    /\s/.test(config.secret)
  ) {
    throw new ElizaRuntimeTransportError("invalid_configuration");
  }
  const agentSlug = context.agentSlug;
  const stage =
    context.agentSlug === "system" &&
    context.stage.startsWith("operator:model-route-probe")
      ? "health-canary"
      : context.stage;
  if (
    !AGENT_PATTERN.test(agentSlug) ||
    !STAGE_PATTERN.test(stage) ||
    (agentSlug === "system" && stage !== "health-canary")
  ) {
    throw new ElizaRuntimeTransportError("invalid_context");
  }
  const endpoint = new URL("/complete", origin);
  const report = async (receipt: ElizaRuntimeReceipt) => {
    try {
      await config.onReceipt?.(receipt);
    } catch {
      throw new ElizaRuntimeTransportError("receipt_unavailable", true);
    }
  };
  return async (_input, init) => {
    if (typeof init?.body !== "string")
      throw new ElizaRuntimeTransportError("unsupported_request");
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw new ElizaRuntimeTransportError("invalid_request");
    }
    if (
      !object(body) ||
      typeof body.model !== "string" ||
      body.stream === true
    ) {
      throw new ElizaRuntimeTransportError(
        body && object(body) && body.stream === true
          ? "streaming_unsupported"
          : "invalid_request",
      );
    }
    if (
      !LIVE_MODELS.has(body.model) ||
      (body.model === OPENROUTER_NEWSLETTER_MODEL &&
        !["belle", "system"].includes(context.agentSlug))
    )
      throw new ElizaRuntimeTransportError("model_not_allowed");
    const outputLimit = body.max_tokens ?? body.max_completion_tokens;
    if (
      !Number.isSafeInteger(outputLimit) ||
      typeof outputLimit !== "number" ||
      outputLimit < 1 ||
      outputLimit > 40_000 ||
      (body.max_tokens !== undefined &&
        body.max_completion_tokens !== undefined &&
        body.max_tokens !== body.max_completion_tokens)
    ) {
      throw new ElizaRuntimeTransportError("invalid_output_limit");
    }
    const jobId = `eliza-${crypto.randomUUID()}`;
    const inputHash = await sha256(JSON.stringify(canonical(body)));
    const envelope = { version: 2, jobId, inputHash, agentSlug, stage, body };
    const request = JSON.stringify(envelope);
    if (new TextEncoder().encode(request).byteLength > MAX_REQUEST_BYTES)
      throw new ElizaRuntimeTransportError("request_too_large");
    const receiptBase = {
      jobId,
      inputHash,
      agentSlug,
      stage,
      model: body.model,
    };
    try {
      await config.onRequest?.(receiptBase);
    } catch {
      throw new ElizaRuntimeTransportError("operation_unavailable");
    }
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(MAX_TRANSPORT_MS)])
      : AbortSignal.timeout(MAX_TRANSPORT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/json",
        },
        body: request,
        signal,
        redirect: "error",
      });
    } catch {
      await report({ ...receiptBase, status: "failed", outcomeUnknown: true });
      throw new ElizaRuntimeTransportError("outcome_unknown", true);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(
        await boundedText(response, MAX_RESPONSE_BYTES, signal),
      );
    } catch {
      await report({ ...receiptBase, status: "failed", outcomeUnknown: true });
      throw new ElizaRuntimeTransportError("invalid_response", true);
    }
    if (!response.ok) {
      const providerStatus =
        object(payload) &&
        typeof payload.error === "string" &&
        PROVIDER_REJECTION_CODES.has(payload.error) &&
        Number.isInteger(payload.providerStatus)
          ? (payload.providerStatus as number)
          : undefined;
      const providerRejected =
        providerStatus !== undefined &&
        providerStatus >= 400 &&
        providerStatus < 500 &&
        providerStatus !== 408 &&
        providerStatus !== 409 &&
        providerStatus === response.status;
      const outcomeUnknown =
        response.status === 408 ||
        response.status === 409 ||
        (!providerRejected &&
          (!object(payload) || payload.outcomeUnknown !== false));
      await report({
        ...receiptBase,
        status: "failed",
        providerStatus,
        outcomeUnknown,
      });
      if (providerRejected) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                object(payload) && payload.error !== "provider_rejected"
                  ? `Provider rejected request (${payload.error})`
                  : "Provider rejected request",
              code: providerStatus,
            },
          }),
          {
            status: providerStatus,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new ElizaRuntimeTransportError("worker_failure", outcomeUnknown);
    }
    if (
      !object(payload) ||
      payload.version !== 2 ||
      payload.jobId !== jobId ||
      payload.inputHash !== inputHash ||
      payload.agentSlug !== agentSlug ||
      payload.stage !== stage ||
      payload.runtimeVersion !== "1.7.2" ||
      !validCompletion(payload.completion, body.model)
    ) {
      await report({ ...receiptBase, status: "failed", outcomeUnknown: true });
      throw new ElizaRuntimeTransportError("invalid_receipt", true);
    }
    const completion = payload.completion;
    const usage = object(completion.usage) ? completion.usage : {};
    await report({
      ...receiptBase,
      status: "completed",
      runtimeVersion: "1.7.2",
      servedModel: completion.model as string,
      inputTokens:
        typeof usage.prompt_tokens === "number"
          ? usage.prompt_tokens
          : undefined,
      outputTokens:
        typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : undefined,
    });
    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
