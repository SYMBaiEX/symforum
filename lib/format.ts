export function formatDate(value: string | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

export function compactNumber(value: number | undefined) {
  if (typeof value !== "number") {
    return "0";
  }
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}
