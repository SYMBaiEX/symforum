export function safeExternalUrl(value: string | undefined | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeImageUrl(value: string | undefined | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed.includes("\\") ? undefined : trimmed;
  }

  return safeExternalUrl(trimmed);
}
