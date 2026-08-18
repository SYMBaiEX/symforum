const BASE64URL_ED25519_LENGTH = 43;
const MAXIMUM_CONFIG_LENGTH = 8_192;
export const MAXIMUM_KEY_OVERLAP_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAXIMUM_DIRECTORY_CACHE_SECONDS = 24 * 60 * 60;

export type PublicEd25519Jwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
};

type TimedPublicEd25519Jwk = PublicEd25519Jwk & {
  notBefore: number;
  notAfter: number;
};

export type WebBotAuthDirectoryKeys = {
  current: PublicEd25519Jwk;
  retiring?: PublicEd25519Jwk;
  nearestExpiry: number;
};

export function parseLegacyPublicJwk(
  value: string | undefined,
): Omit<PublicEd25519Jwk, "kid"> | null {
  if (value === undefined || value.length > MAXIMUM_CONFIG_LENGTH) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return isPublicEd25519Jwk(parsed, false)
      ? { kty: "OKP", crv: "Ed25519", x: parsed.x }
      : null;
  } catch {
    return null;
  }
}

export function resolveDirectoryKeys(
  value: string | undefined,
  now: number,
): WebBotAuthDirectoryKeys | null {
  if (value === undefined || value.length > MAXIMUM_CONFIG_LENGTH) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      !isPlainObject(parsed) ||
      !hasOnlyKeys(parsed, ["current", "retiring"]) ||
      !isTimedPublicEd25519Jwk(parsed.current) ||
      (parsed.retiring !== undefined && !isTimedPublicEd25519Jwk(parsed.retiring))
    ) {
      return null;
    }

    const current = parsed.current;
    const retiring = parsed.retiring;
    if (current.notBefore > now || current.notAfter <= now) return null;

    if (retiring !== undefined) {
      if (current.kid === retiring.kid) return null;
      const overlapStart = Math.max(current.notBefore, retiring.notBefore);
      const overlapEnd = Math.min(current.notAfter, retiring.notAfter);
      if (
        overlapEnd <= overlapStart ||
        overlapEnd - overlapStart > MAXIMUM_KEY_OVERLAP_MS
      ) {
        return null;
      }

      // An expired retirement record is valid operator state, but is never
      // republished. A non-expired retiring key must already be in its overlap.
      if (retiring.notAfter > now && retiring.notBefore > now) return null;
    }

    let activeRetiring: PublicEd25519Jwk | undefined;
    let nearestExpiry = current.notAfter;
    if (retiring !== undefined && retiring.notAfter > now) {
      activeRetiring = stripTimes(retiring);
      nearestExpiry = Math.min(nearestExpiry, retiring.notAfter);
    }
    return {
      current: stripTimes(current),
      ...(activeRetiring === undefined ? {} : { retiring: activeRetiring }),
      nearestExpiry,
    };
  } catch {
    return null;
  }
}

export function directoryCacheSeconds(nearestExpiry: number, now: number): number {
  return Math.max(
    0,
    Math.min(
      MAXIMUM_DIRECTORY_CACHE_SECONDS,
      Math.floor((nearestExpiry - now) / 1_000),
    ),
  );
}

function isTimedPublicEd25519Jwk(value: unknown): value is TimedPublicEd25519Jwk {
  if (!isPublicEd25519Jwk(value, true) || !isPlainObject(value)) return false;
  return (
    typeof value.notBefore === "number" &&
    Number.isFinite(value.notBefore) &&
    typeof value.notAfter === "number" &&
    Number.isFinite(value.notAfter) &&
    value.notBefore < value.notAfter
  );
}

function isPublicEd25519Jwk(
  value: unknown,
  requireKid: boolean,
): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  const allowedKeys = requireKid
    ? ["kty", "crv", "x", "kid", "notBefore", "notAfter"]
    : ["kty", "crv", "x", "kid", "use", "key_ops", "alg", "ext"];
  if (!hasOnlyKeys(value, allowedKeys)) return false;
  return (
    value.kty === "OKP" &&
    value.crv === "Ed25519" &&
    typeof value.x === "string" &&
    new RegExp(`^[A-Za-z0-9_-]{${BASE64URL_ED25519_LENGTH}}$`).test(value.x) &&
    (!requireKid || (typeof value.kid === "string" && value.kid.length > 0 && value.kid.length <= 128))
  );
}

function stripTimes(value: TimedPublicEd25519Jwk): PublicEd25519Jwk {
  return { kty: "OKP", crv: "Ed25519", x: value.x, kid: value.kid };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
