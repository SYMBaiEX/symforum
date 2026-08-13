import {
  directoryResponseHeaders,
  helpers,
  jwkToKeyID,
  MediaType,
} from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ed25519Jwk = JsonWebKey & {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  d?: string;
};

export async function GET(request: Request) {
  const publicJwk = parseJwk(process.env.WEB_BOT_AUTH_PUBLIC_JWK);
  const privateJwk = parseJwk(process.env.WEB_BOT_AUTH_PRIVATE_JWK);
  if (
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
    // `signerFromJWK` derives the key id from the private JWK thumbprint.
    // `kid` is emitted in the public directory below, but is not part of the
    // Web Crypto `JsonWebKey` type accepted by the signing helper.
    const signer = await signerFromJWK(privateJwk);
    const body = JSON.stringify({
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          x: publicJwk.x,
          kid: keyid,
        },
      ],
    });
    const responseHeaders = new Headers({
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
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

function parseJwk(value: string | undefined): Ed25519Jwk | null {
  if (value === undefined || value.length > 2_048) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Ed25519Jwk>;
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
    return parsed as Ed25519Jwk;
  } catch {
    return null;
  }
}
