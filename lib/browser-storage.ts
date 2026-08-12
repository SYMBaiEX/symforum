type BrowserStorageKind = "localStorage" | "sessionStorage";

export function getBrowserStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window[kind];
  } catch {
    // Sandboxed documents without allow-same-origin expose an opaque origin.
    // Reading the storage property itself throws a SecurityError there.
    return null;
  }
}
