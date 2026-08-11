export function safeForumIsoDate(value: unknown) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "number" && !Number.isFinite(value)) ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return undefined;
  }

  const normalizedValue = typeof value === "string" ? value.trim() : value;
  const timestamp =
    typeof normalizedValue === "number"
      ? normalizedValue
      : /^\d+$/.test(normalizedValue)
        ? Number(normalizedValue)
        : Date.parse(normalizedValue);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : undefined;
}
