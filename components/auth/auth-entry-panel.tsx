import { LegacySignInPanel } from "@/components/auth/legacy-signin-panel";
import { SignInPanel } from "@/components/signin-panel";
import { IdentitySignIn } from "./identity-signin";

export function AuthEntryPanel() {
  if (process.env.NEXT_PUBLIC_BETTER_AUTH_ENABLED === "true") return <IdentitySignIn />;
  return process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true" ? (
    <SignInPanel />
  ) : (
    <LegacySignInPanel />
  );
}
