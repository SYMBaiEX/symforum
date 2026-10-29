import {
  getSignInUrl,
  getSignUpUrl,
  handleAuth,
  signOut,
} from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { assertHumanAuthConfiguration } from "./session-config";

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
  // A public username must never be exchanged for a private email in a URL.
  // Only echo an email supplied by the user; otherwise show hosted sign-in.
  const loginHint = identifier.includes("@")
    ? (validEmail(identifier) ?? undefined)
    : undefined;

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
