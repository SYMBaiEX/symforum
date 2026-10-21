import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";

export const RUNTIME_VERSION = "1.7.2";
export const MODEL = "~deepseek/deepseek-v4-flash-latest";
export const MAX_REQUEST_BYTES = 128 * 1024;
export const MAX_PROMPT_BYTES = 100 * 1024;
export const MAX_PROVIDER_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 128 * 1024;
export const MAX_OUTPUT_TOKENS = 10_000;

export class WorkerError extends Error {
  constructor(code, status = 400, outcomeUnknown = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

export function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

export function requestHash(request) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex");
}

const schemaKeys = new Set([
  "$schema",
  "title",
  "description",
  "$comment",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "format",
  "default",
  "examples",
]);
const schemaAnnotations = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft-07/schema#",
]);

export function compileOutputSchema(schema) {
  let nodes = 0;
  function inspect(node, depth = 0) {
    if (
      ++nodes > 1500 ||
      depth > 12 ||
      (!record(node) && typeof node !== "boolean")
    ) {
      throw new WorkerError("invalid_schema");
    }
    if (typeof node === "boolean") return;
    for (const key of Object.keys(node)) {
      if (!schemaKeys.has(key))
        throw new WorkerError("unsupported_schema_keyword");
    }
    if (node.$schema !== undefined && !schemaAnnotations.has(node.$schema)) {
      throw new WorkerError("unsupported_schema_version");
    }
    if (
      node.format !== undefined &&
      !["uri", "safeint"].includes(node.format)
    ) {
      throw new WorkerError("unsupported_schema_format");
    }
    if (node.properties !== undefined) {
      if (!record(node.properties) || Object.keys(node.properties).length > 100)
        throw new WorkerError("invalid_schema");
      for (const child of Object.values(node.properties))
        inspect(child, depth + 1);
    }
    for (const key of ["items", "additionalProperties", "not"]) {
      if (node[key] !== undefined) inspect(node[key], depth + 1);
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (node[key] !== undefined) {
        if (!Array.isArray(node[key]) || node[key].length > 20)
          throw new WorkerError("invalid_schema");
        for (const child of node[key]) inspect(child, depth + 1);
      }
    }
    if (node.enum && (!Array.isArray(node.enum) || node.enum.length > 100))
      throw new WorkerError("invalid_schema");
  }
  inspect(schema);
  if (!record(schema)) throw new WorkerError("invalid_schema");
  const normalized = structuredClone(schema);
  // Annotations are recognized, never resolved/fetched. There are no $refs.
  delete normalized.$schema;
  const ajv = new Ajv2020({
    strict: false,
    allErrors: false,
    ownProperties: true,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    loopRequired: 50,
    loopEnum: 50,
  });
  ajv.addFormat("uri", {
    type: "string",
    validate(value) {
      if (value.length > 8192 || /\s/.test(value)) return false;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  ajv.addFormat("safeint", { type: "number", validate: Number.isSafeInteger });
  try {
    return ajv.compile(normalized);
  } catch {
    throw new WorkerError("invalid_schema");
  }
}

export function validateRequest(input) {
  const fields = [
    "version",
    "jobId",
    "inputHash",
    "kind",
    "system",
    "prompt",
    "schema",
    "model",
    "maxOutputTokens",
  ];
  if (
    !record(input) ||
    Object.keys(input).some((key) => !fields.includes(key)) ||
    input.version !== 1 ||
    !["suki-reply", "belle-newsletter"].includes(input.kind) ||
    typeof input.jobId !== "string" ||
    !/^[A-Za-z0-9:_-]{1,200}$/.test(input.jobId) ||
    typeof input.inputHash !== "string" ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(input.inputHash) ||
    typeof input.system !== "string" ||
    !input.system.trim() ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim()
  ) {
    throw new WorkerError("invalid_request");
  }
  if (input.model !== MODEL) throw new WorkerError("model_not_allowed");
  if (
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > MAX_OUTPUT_TOKENS
  ) {
    throw new WorkerError("invalid_output_limit");
  }
  if (
    Buffer.byteLength(input.prompt) + Buffer.byteLength(input.system) >
    MAX_PROMPT_BYTES
  ) {
    throw new WorkerError("prompt_too_large", 413);
  }
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES)
    throw new WorkerError("request_too_large", 413);
  return { request: input, validateOutput: compileOutputSchema(input.schema) };
}

export async function readBoundedResponse(
  response,
  limit = MAX_PROVIDER_BYTES,
) {
  const length = response.headers.get("content-length");
  if (length && Number(length) > limit) {
    await response.body?.cancel();
    throw new WorkerError("provider_response_too_large", 502);
  }
  if (!response.body) throw new WorkerError("provider_empty_response", 502);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new WorkerError("provider_response_too_large", 502);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
