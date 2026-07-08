export function formatDate(value: string | number) {
  const isDateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    ...(isDateOnly ? { timeZone: "UTC" } : {}),
  }).format(date);
}

export function compactNumber(value: number | undefined) {
  if (typeof value !== "number") {
    return "0";
  }
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}
