/** JSON-compatible projection of Convex argument validators for MCP and WebMCP. */
export type ForumJsonSchema = {
  type?: string;
  const?: unknown;
  anyOf?: ForumJsonSchema[];
  properties?: Record<string, ForumJsonSchema>;
  required?: string[];
  additionalProperties?: boolean | ForumJsonSchema;
  items?: ForumJsonSchema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
};

type ConvexValidator = {
  type: string;
  value?: unknown;
  keys?: ConvexValidator;
  values?: ConvexValidator;
};
export function convexValidatorToJsonSchema(
  validator: ConvexValidator,
): ForumJsonSchema {
  switch (validator.type) {
    case "object": {
      const fields = validator.value as Record<
        string,
        { fieldType: ConvexValidator; optional: boolean }
      >;
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(fields).map(([name, field]) => [
            name,
            convexValidatorToJsonSchema(field.fieldType),
          ]),
        ),
        required: Object.entries(fields)
          .filter(([, field]) => !field.optional)
          .map(([name]) => name),
        additionalProperties: false,
      };
    }
    case "id":
      return { type: "string", minLength: 1, maxLength: 256 };
    case "string":
      return { type: "string" };
    case "number":
    case "float64":
      return { type: "number" };
    case "boolean":
    case "null":
      return { type: validator.type };
    case "literal":
      return { const: validator.value };
    case "array":
      return {
        type: "array",
        items: convexValidatorToJsonSchema(validator.value as ConvexValidator),
        maxItems: 8192,
      };
    case "union":
      return {
        anyOf: (validator.value as ConvexValidator[]).map(
          convexValidatorToJsonSchema,
        ),
      };
    case "record":
      return {
        type: "object",
        additionalProperties: convexValidatorToJsonSchema(validator.values!),
      };
    // JSON has no bigint or binary representation; these are intentionally not tool arguments.
    default:
      throw new Error(
        `Unsupported forum argument validator: ${validator.type}`,
      );
  }
}

/** Returns a actionable validation error; authorization and semantic rules remain server-side. */
export function validateForumJsonSchema(
  schema: ForumJsonSchema,
  value: unknown,
  path = "arguments",
): string | null {
  if (schema.anyOf)
    return schema.anyOf.some(
      (option) => validateForumJsonSchema(option, value, path) === null,
    )
      ? null
      : `${path} does not match an allowed value.`;
  if (Object.hasOwn(schema, "const") && value !== schema.const)
    return `${path} must equal ${JSON.stringify(schema.const)}.`;
  if (!schema.type) return null;
  if (schema.type === "null")
    return value === null ? null : `${path} must be null.`;
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return `${path} must be an object.`;
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(object, key)) return `${path}.${key} is required.`;
    for (const [key, field] of Object.entries(object)) {
      const child =
        schema.properties && Object.hasOwn(schema.properties, key)
          ? schema.properties[key]
          : undefined;
      if (!child && schema.additionalProperties === false)
        return `${path}.${key} is not allowed.`;
      const childSchema =
        child ??
        (typeof schema.additionalProperties === "object"
          ? schema.additionalProperties
          : null);
      if (childSchema) {
        const error = validateForumJsonSchema(
          childSchema,
          field,
          `${path}.${key}`,
        );
        if (error) return error;
      }
    }
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array.`;
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      return `${path} has an invalid item count.`;
    for (let i = 0; i < value.length; i++) {
      const error = validateForumJsonSchema(
        schema.items ?? {},
        value[i],
        `${path}[${i}]`,
      );
      if (error) return error;
    }
    return null;
  }
  if (
    schema.type === "integer" &&
    (typeof value !== "number" || !Number.isSafeInteger(value))
  )
    return `${path} must be an integer.`;
  if (schema.type !== "integer" && typeof value !== schema.type)
    return `${path} must be ${schema.type}.`;
  if (
    typeof value === "string" &&
    ((schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength))
  )
    return `${path} has an invalid length.`;
  if (
    typeof value === "string" &&
    schema.pattern !== undefined &&
    !new RegExp(schema.pattern).test(value)
  )
    return `${path} has an invalid format.`;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    return `${path} has an invalid numeric value.`;
  return null;
}
