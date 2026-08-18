import {
  directoryResponseHeaders,
  helpers,
  jwkToKeyID,
  MediaType,
} from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import {
  directoryCacheSeconds,
  parseLegacyPublicJwk,
  resolveDirectoryKeys,
} from "@/lib/web-bot-auth-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PrivateEd25519Jwk = JsonWebKey & {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  d?: string;
};

export async function GET(request: Request) {
  const now = Date.now();
  const privateJwk = parsePrivateJwk(process.env.WEB_BOT_AUTH_PRIVATE_JWK);
  const configuredKeys = resolveDirectoryKeys(
    process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET,
    now,
  );
  const legacyPublicJwk = parseLegacyPublicJwk(
    process.env.WEB_BOT_AUTH_PUBLIC_JWK,
  );
  const isKeysetConfigured =
    process.env.WEB_BOT_AUTH_PUBLIC_JWK_SET !== undefined;
  const publicJwk = configuredKeys?.current ?? legacyPublicJwk;
  if (
    (isKeysetConfigured && configuredKeys === null) ||
    publicJwk === null ||
    privateJwk === null ||
    privateJwk.d === undefined ||
    privateJwk.x !== publicJwk.x
  ) {
    return new Response("Web Bot Auth is not configured.\n", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  try {
    const keyid = await jwkToKeyID(
      publicJwk,
      helpers.WEBCRYPTO_SHA256,
      helpers.BASE64URL_DECODE,
    );
    if (configuredKeys !== null && configuredKeys.current.kid !== keyid) {
      throw new Error("Current key id does not match its public JWK.");
    }
    // `signerFromJWK` derives the key id from the private JWK thumbprint.
    // `kid` is emitted in the public directory below, but is not part of the
    // Web Crypto `JsonWebKey` type accepted by the signing helper.
    const signer = await signerFromJWK(privateJwk);
    const body = JSON.stringify({
      keys: [
        { kty: "OKP", crv: "Ed25519", x: publicJwk.x, kid: keyid },
        ...(configuredKeys?.retiring === undefined
          ? []
          : [configuredKeys.retiring]),
      ],
    });
    const cacheSeconds = directoryCacheSeconds(
      configuredKeys?.nearestExpiry ?? now + 86_400_000,
      now,
    );
    const responseHeaders = new Headers({
      "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      "Content-Type": MediaType.HTTP_MESSAGE_SIGNATURES_DIRECTORY,
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    });
    const signatureHeaders = await directoryResponseHeaders(
      {
        request,
        response: { status: 200, headers: responseHeaders },
      },
      [signer],
      {
        created: new Date(),
        expires: new Date(Date.now() + 60_000),
      },
    );
    responseHeaders.set("Signature", signatureHeaders.Signature);
    responseHeaders.set("Signature-Input", signatureHeaders["Signature-Input"]);
    responseHeaders.set(
      "Link",
      '<https://www.symbaiex.com/agent/instructions>; rel="describedby"; type="text/markdown"',
    );
    return new Response(body, { headers: responseHeaders });
  } catch {
    return new Response("Web Bot Auth configuration is invalid.\n", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}

function parsePrivateJwk(value: string | undefined): PrivateEd25519Jwk | null {
  if (value === undefined || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PrivateEd25519Jwk>;
    if (
      parsed.kty !== "OKP" ||
      parsed.crv !== "Ed25519" ||
      typeof parsed.x !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.x) ||
      (parsed.d !== undefined &&
        (typeof parsed.d !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.d)))
    ) {
      return null;
    }
    return parsed as PrivateEd25519Jwk;
  } catch {
    return null;
  }
}
