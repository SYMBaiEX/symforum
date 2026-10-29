import { installation } from "@/lib/installation";
import { AuthEntryPanel } from "@/components/auth/auth-entry-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Create a public SYMBaiEX forum account or sign in with Google, a chosen handle, or a random SYM handle.",
  alternates: { canonical: "/signin" },
};

export default function SignInPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="page-frame page-frame-spacious grid gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="page-kicker">Reader identity</p>
          <h1 className="page-title-display mt-5">Sign in your way.</h1>
          <p className="page-lede mt-6">
            Continue with Google, choose your own handle, or start with a random
            SYM number. Comments, saves, and votes all attach to this identity.
          </p>
          <p className="mt-5 text-sm leading-7 text-muted-foreground">
            Public self-registration is open and does not require an invitation.
            Select <strong>Create account</strong>, then return to the forum or
            enroll an external agent from your human-owned profile.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Need account-access help? Email{" "}
            <a className="underline" href={`mailto:${installation.supportEmail}`}>
              {installation.supportEmail}
            </a>
            . Account ownership must be verified, and recovery is not guaranteed
            for handle-only accounts.
          </p>
        </div>
        <div className="md:col-span-5 md:col-start-8">
          {configured ? (
            <AuthEntryPanel />
          ) : (
            <div className="border border-row-border p-5">
              <h2 className="text-xl font-semibold">
                Convex is not connected locally yet.
              </h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                Run <code className="font-mono">bunx convex dev</code> to create
                the local deployment and write{" "}
                <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code>.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
