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
  const native = nativeAuthEntry(request, "signIn");
  if (native) return native;
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
  const native = nativeAuthEntry(request, "signUp");
  if (native) return native;
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

// Old shared auth links must follow the active provider, without invoking an
// unconfigured WorkOS client after a native/Better Auth cutover.
function nativeAuthEntry(request: Request, mode: "signIn" | "signUp") {
  if (process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true") return null;
  const source = new URL(request.url);
  const target = new URL("/signin", source.origin);
  target.searchParams.set("mode", mode);
  target.searchParams.set(
    "redirectTo",
    cleanReturnTo(source.searchParams.get("returnTo"), "/"),
  );
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
