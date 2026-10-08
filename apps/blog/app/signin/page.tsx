import type { Metadata } from "next";
import { AuthEntryPanel } from "@/components/auth/auth-entry-panel";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your SYMBaiEX account across the platform.",
  alternates: { canonical: "/signin" },
};

export default function SignInPage() {
  return (
    <main className="mx-auto grid min-h-[65vh] w-full max-w-6xl gap-10 px-4 py-12 md:grid-cols-12 md:px-8 md:py-20">
      <section className="md:col-span-5">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Shared identity
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">
          One account across SYMBaiEX.
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          Your handle, profile, and account access work across the Blog, Forum,
          News, and Newsletter.
        </p>
      </section>
      <section className="md:col-span-6 md:col-start-7">
        <AuthEntryPanel />
      </section>
    </main>
  );
}
