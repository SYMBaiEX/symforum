const MAX_CAUSE_DEPTH = 5;
const MAX_SCHEMA_ISSUES = 4;
const MAX_SCHEMA_DIAGNOSTIC_CHARS = 220;
const MAX_PATH_SEGMENTS = 8;
const MAX_ARRAY_INDEX = 8_192;
const MAX_BOUND = 1_000_000;

const SAFE_SCHEMA_PATH_KEYS = new Set([
  "status",
  "title",
  "body",
  "content",
  "text",
  "name",
  "slug",
  "description",
  "summary",
  "category",
  "kind",
  "type",
  "confidence",
  "claims",
  "claim",
  "sourceCandidateId",
  "originalValue",
  "discussionQuestion",
  "poll",
  "question",
  "options",
  "imageCandidateId",
  "tags",
  "items",
  "results",
  "sources",
  "url",
  "date",
  "author",
  "answer",
  "subject",
  "headline",
  "dek",
  "thesis",
  "lead",
  "heroHnItemId",
  "chart",
  "subtitle",
  "stories",
  "hnItemId",
  "whyItMatters",
  "takeaways",
  "signalScore",
  "practicalMoves",
  "whatToWatch",
  "sections",
  "heading",
  "fields",
  "path",
  "verdict",
  "quoteIds",
  "coherence",
  "coherenceReason",
  "reason",
]);

function ownValue(value: object, key: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}

function safePath(path: unknown): string {
  if (!Array.isArray(path)) return "[root]";

  const segments = path.slice(0, MAX_PATH_SEGMENTS).map((segment) => {
    if (typeof segment === "number") {
      return Number.isSafeInteger(segment) &&
        segment >= 0 &&
        segment <= MAX_ARRAY_INDEX
        ? `[${segment}]`
        : "[index]";
    }
    if (typeof segment === "string" && SAFE_SCHEMA_PATH_KEYS.has(segment)) {
      return segment;
    }
    return "[field]";
  });

  return segments.length ? segments.join(".").replaceAll(".[", "[") : "[root]";
}

function safeBound(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_BOUND
    ? value
    : undefined;
}

function diagnosticForIssue(issue: unknown): string | undefined {
  if (typeof issue !== "object" || issue === null) return;

  const code = ownValue(issue, "code");
  const path = safePath(ownValue(issue, "path"));
  if (code === "invalid_value") return `enum@${path}`;
  if (
    code === "invalid_union" ||
    code === "unrecognized_keys" ||
    code === "invalid_format"
  ) {
    return `${code}@${path}`;
  }
  if (code === "too_big") {
    const maximum = safeBound(ownValue(issue, "maximum"));
    return `too_big@${path}${maximum === undefined ? "" : `(max=${maximum})`}`;
  }
  if (code === "too_small") {
    const minimum = safeBound(ownValue(issue, "minimum"));
    return `too_small@${path}${minimum === undefined ? "" : `(min=${minimum})`}`;
  }
  if (code === "invalid_type") {
    const expected = ownValue(issue, "expected");
    const safeExpected =
      typeof expected === "string" &&
      [
        "string",
        "number",
        "boolean",
        "array",
        "object",
        "null",
        "undefined",
        "date",
        "bigint",
        "symbol",
        "function",
        "nan",
      ].includes(expected)
        ? expected
        : undefined;
    return `invalid_type@${path}${safeExpected === undefined ? "" : `(expected=${safeExpected})`}`;
  }
}

/** Formats only allowlisted Zod issue metadata from an error cause chain. */
export function formatAISchemaDiagnostics(cause: unknown): string | undefined {
  try {
    const visited = new Set<object>();
    const diagnostics: string[] = [];
    let current = cause;

    for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
      if (
        typeof current !== "object" ||
        current === null ||
        visited.has(current)
      ) {
        break;
      }
      visited.add(current);

      const issues = ownValue(current, "issues");
      if (Array.isArray(issues)) {
        for (const issue of issues.slice(
          0,
          MAX_SCHEMA_ISSUES - diagnostics.length,
        )) {
          const diagnostic = diagnosticForIssue(issue);
          if (diagnostic !== undefined) diagnostics.push(diagnostic);
        }
      }
      if (diagnostics.length >= MAX_SCHEMA_ISSUES) break;
      current = ownValue(current, "cause");
    }

    if (diagnostics.length === 0) return;
    const result = diagnostics.join(", ").slice(0, MAX_SCHEMA_DIAGNOSTIC_CHARS);
    return `schemaIssues=${result}`;
  } catch {
    return;
  }
}
