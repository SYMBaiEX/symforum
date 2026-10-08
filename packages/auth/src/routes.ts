import {
  getSignInUrl,
  getSignUpUrl,
  handleAuth,
  signOut,
} from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { assertHumanAuthConfiguration } from "./session-config";

const HANDLE_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const handleCallback = handleAuth();
export const authCallback: typeof handleCallback = (request) => {
  assertHumanAuthConfiguration(process.env);
  return handleCallback(request);
};

export async function authSignIn(request: Request) {
  assertHumanAuthConfiguration(process.env);
  const url = new URL(request.url);
  const identifier = (url.searchParams.get("identifier") ?? "").trim();
  const loginHint = identifier.includes("@")
    ? validEmail(identifier)
    : await lookupVerifiedEmailForHandle(identifier);
  if (loginHint === null) {
    return NextResponse.redirect(
      new URL("/signin?status=account-not-found", url.origin),
      303,
    );
  }

  const destination = cleanReturnTo(url.searchParams.get("returnTo"), "/");
  return NextResponse.redirect(
    await getSignInUrl({ loginHint, returnTo: destination }),
    303,
  );
}

export async function authSignUp(request: Request) {
  assertHumanAuthConfiguration(process.env);
  const url = new URL(request.url);
  const email = validEmail(url.searchParams.get("email") ?? "");
  if (email === null) {
    return NextResponse.redirect(
      new URL("/signin?status=verified-email-required", url.origin),
      303,
    );
  }

  const destination = cleanReturnTo(
    url.searchParams.get("returnTo"),
    "/auth/complete-signup",
  );
  return NextResponse.redirect(
    await getSignUpUrl({ loginHint: email, returnTo: destination }),
    303,
  );
}

export async function authSignOut(request: Request) {
  assertHumanAuthConfiguration(process.env);
  const url = new URL(request.url);
  await signOut({ returnTo: new URL("/signin", url.origin).toString() });
  return NextResponse.redirect(new URL("/signin", url.origin), 303);
}

function validEmail(value: string) {
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

function cleanReturnTo(value: string | null, fallback: string) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }
  return value;
}

async function lookupVerifiedEmailForHandle(handle: string) {
  if (!HANDLE_PATTERN.test(handle)) return null;
  const endpoint =
    process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const secret = process.env.AUTH_HANDLE_LOOKUP_SECRET;
  if (!endpoint || !secret) {
    throw new Error("Handle login lookup is not configured.");
  }

  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/auth/handle-login`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ handle: handle.toLowerCase() }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Handle login lookup failed.");
  }

  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).email !== "string"
  ) {
    throw new Error("Handle login lookup returned an invalid response.");
  }
  return validEmail((value as { email: string }).email);
}
