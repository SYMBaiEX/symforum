import { SignInPanel } from "@/components/signin-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
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
        </div>
        <div className="md:col-span-5 md:col-start-8">
          {configured ? (
            <SignInPanel />
          ) : (
            <div className="border border-row-border p-5">
              <h2 className="text-xl font-semibold">
                Convex is not connected locally yet.
              </h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                Run <code className="font-mono">npx convex dev</code> to create
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
