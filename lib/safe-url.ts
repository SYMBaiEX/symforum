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

  const externalUrl = safeExternalUrl(trimmed);
  if (!externalUrl) {
    return undefined;
  }

  const url = new URL(externalUrl);
  if (
    (url.hostname === "symbaiex.com" ||
      url.hostname === "www.symbaiex.com" ||
      url.hostname === "forum.symbaiex.com") &&
    url.pathname.startsWith("/images/")
  ) {
    return `${url.pathname}${url.search}`;
  }

  return externalUrl;
}

export function isLocalImageUrl(value: string | undefined | null) {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}
