import { LegacySignInPanel } from "@/components/auth/legacy-signin-panel";
import { SignInPanel } from "@/components/signin-panel";

export function AuthEntryPanel() {
  return process.env.NEXT_PUBLIC_WORKOS_ENABLED === "true" ? (
    <SignInPanel />
  ) : (
    <LegacySignInPanel />
  );
}
