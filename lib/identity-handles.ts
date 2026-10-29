/** Provider defaults are suggestions, never evidence of account ownership. */
export function identityHandleBase(
  provider: "solana" | "telegram",
  accountId: string,
  fingerprint: string,
  telegramUsername?: string,
) {
  if (provider === "solana")
    return `${accountId.slice(0, 6)}-${accountId.slice(-4)}`.toLowerCase();
  const handle = telegramUsername?.replace(/^@/, "").toLowerCase();
  return handle && /^[a-z0-9][a-z0-9_]{2,31}$/.test(handle)
    ? handle
    : `telegram-${fingerprint.slice(0, 10)}`;
}

export function identityHandleCandidate(
  base: string,
  fingerprint: string,
  attempt: number,
) {
  if (attempt === 0) return base;
  return `${base.slice(0, 19)}-${fingerprint.slice(0, 8)}${attempt === 1 ? "" : `-${attempt}`}`;
}
