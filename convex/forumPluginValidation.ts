import { ConvexError, v, type PropertyValidators } from "convex/values";
import type { TableNames } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  convexValidatorToJsonSchema,
  validateForumJsonSchema,
} from "../lib/forum-plugin-schema";

type Shape = {
  type: string;
  tableName?: string;
  value?: unknown;
  values?: Shape;
};
export function validateForumOperationArgs(
  ctx: QueryCtx | MutationCtx,
  fields: PropertyValidators,
  input: Record<string, unknown>,
) {
  const validator = (v.object(fields) as unknown as { json: Shape }).json;
  const error = validateForumJsonSchema(
    convexValidatorToJsonSchema(validator),
    input,
  );
  if (error)
    throw new ConvexError({ code: "PLUGIN_INVALID_ARGUMENTS", message: error });
  checkIds(ctx, validator, input);
  if (JSON.stringify(input).length > 128_000)
    throw new ConvexError("Forum arguments exceed 128000 characters.");
}
function checkIds(
  ctx: QueryCtx | MutationCtx,
  shape: Shape,
  value: unknown,
): void {
  if (shape.type === "id") {
    if (
      typeof value !== "string" ||
      !(shape.tableName === "_storage"
        ? ctx.db.system.normalizeId("_storage", value)
        : ctx.db.normalizeId(shape.tableName! as TableNames, value))
    )
      throw new ConvexError({
        code: "PLUGIN_INVALID_ARGUMENTS",
        message: `Invalid ${shape.tableName} identifier.`,
      });
  } else if (shape.type === "object") {
    const fields = shape.value as Record<string, { fieldType: Shape }>;
    for (const [key, field] of Object.entries(fields)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) checkIds(ctx, field.fieldType, child);
    }
  } else if (shape.type === "array") {
    for (const child of value as unknown[])
      checkIds(ctx, shape.value as Shape, child);
  } else if (shape.type === "union") {
    const variants = shape.value as Shape[];
    const variant = variants.find(
      (item) =>
        validateForumJsonSchema(convexValidatorToJsonSchema(item), value) ===
        null,
    );
    if (variant) checkIds(ctx, variant, value);
  } else if (shape.type === "record") {
    for (const child of Object.values(value as Record<string, unknown>))
      checkIds(ctx, shape.values!, child);
  }
}
export function canonicalForumJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalForumJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalForumJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
