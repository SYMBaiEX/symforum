import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import {
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_RESOURCE,
  SERVICE_AUTH_TOKEN_ID,
  SERVICE_AUTH_TOKEN_KIND,
} from "./agent-service-auth-config";

type KeySet = {
  privateKey: KeyObject;
  publicKeys: Map<string, KeyObject>;
  kid: string;
  jwks: { keys: JsonWebKey[] };
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Fail closed on malformed config, private-key leakage, weak keys, or mismatched signing key. */
export function serviceAuthKeys(environment: {
  [key: string]: string | undefined;
  AGENT_SERVICE_AUTH_PRIVATE_JWK?: string;
  AGENT_SERVICE_AUTH_PUBLIC_JWKS?: string;
}): KeySet {
  const privateJwk: unknown = JSON.parse(
    environment.AGENT_SERVICE_AUTH_PRIVATE_JWK ?? "null",
  );
  const publicSet: unknown = JSON.parse(
    environment.AGENT_SERVICE_AUTH_PUBLIC_JWKS ?? "null",
  );
  if (
    !record(privateJwk) ||
    privateJwk.kty !== "RSA" ||
    typeof privateJwk.kid !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(privateJwk.kid) ||
    !record(publicSet) ||
    !Array.isArray(publicSet.keys) ||
    publicSet.keys.length < 1 ||
    publicSet.keys.length > 3
  )
    throw new Error("Invalid service authentication key configuration.");
  const publicKeys = new Map<string, KeyObject>();
  const keys: JsonWebKey[] = [];
  for (const key of publicSet.keys) {
    if (
      !record(key) ||
      Object.keys(key).some(
        (name) => !["kty", "kid", "alg", "use", "n", "e"].includes(name),
      ) ||
      key.kty !== "RSA" ||
      key.alg !== "RS256" ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      publicKeys.has(key.kid)
    )
      throw new Error("Invalid public signing key.");
    const imported = createPublicKey({ key: key as JsonWebKey, format: "jwk" });
    if ((imported.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      throw new Error("RSA signing keys must be at least 2048 bits.");
    publicKeys.set(key.kid, imported);
    keys.push(key as JsonWebKey);
  }
  const privateKey = createPrivateKey({
    key: privateJwk as JsonWebKey,
    format: "jwk",
  });
  const derived = createPublicKey(privateKey).export({ format: "jwk" });
  const current = keys.find((key) => key.kid === privateJwk.kid);
  if (!current || current.n !== derived.n || current.e !== derived.e)
    throw new Error("Signing key is not published.");
  return { privateKey, publicKeys, kid: privateJwk.kid, jwks: { keys } };
}

export function signServiceJwt(
  keys: KeySet,
  data: {
    registrationId: string;
    jti: string;
    issuedAt: number;
    expiresAt: number;
  },
  kind: "assertion" | "access",
) {
  const header = Buffer.from(
    JSON.stringify({
      alg: "RS256",
      typ: kind === "assertion" ? "oauth-id-jag+jwt" : "at+jwt",
      kid: keys.kid,
    }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: SERVICE_AUTH_ISSUER,
      aud: kind === "assertion" ? SERVICE_AUTH_ISSUER : SERVICE_AUTH_RESOURCE,
      sub: data.registrationId,
      jti: data.jti,
      iat: Math.floor(data.issuedAt / 1000),
      exp: Math.floor(data.expiresAt / 1000),
      scope: "evidence",
      [SERVICE_AUTH_TOKEN_KIND]: kind,
      [SERVICE_AUTH_TOKEN_ID]: data.jti,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), keys.privateKey).toString("base64url")}`;
}

export function verifyServiceJwt(
  keys: KeySet,
  value: string,
  kind: "assertion" | "access",
  now = Date.now(),
  allowExpired = false,
) {
  if (value.length > 12_000) throw new Error("Invalid token.");
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    throw new Error("Invalid token.");
  const header: unknown = JSON.parse(
    Buffer.from(parts[0], "base64url").toString(),
  );
  const payload: unknown = JSON.parse(
    Buffer.from(parts[1], "base64url").toString(),
  );
  if (
    !record(header) ||
    header.alg !== "RS256" ||
    header.typ !== (kind === "assertion" ? "oauth-id-jag+jwt" : "at+jwt") ||
    typeof header.kid !== "string" ||
    header.crit !== undefined
  )
    throw new Error("Invalid token.");
  const key = keys.publicKeys.get(header.kid);
  if (
    !key ||
    !verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url"),
    )
  )
    throw new Error("Invalid token.");
  if (
    !record(payload) ||
    payload.iss !== SERVICE_AUTH_ISSUER ||
    payload.aud !==
      (kind === "assertion" ? SERVICE_AUTH_ISSUER : SERVICE_AUTH_RESOURCE) ||
    payload[SERVICE_AUTH_TOKEN_KIND] !== kind ||
    payload.scope !== "evidence" ||
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    payload[SERVICE_AUTH_TOKEN_ID] !== payload.jti ||
    typeof payload.exp !== "number" ||
    !Number.isSafeInteger(payload.exp) ||
    typeof payload.iat !== "number" ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > Math.floor(now / 1000) + 60 ||
    payload.exp <= payload.iat ||
    (!allowExpired && payload.exp * 1000 <= now)
  )
    throw new Error("Invalid token.");
  return {
    registrationId: payload.sub,
    jti: payload.jti,
    expiresAt: payload.exp * 1000,
  };
}
