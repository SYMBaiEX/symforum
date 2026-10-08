export default function CompleteAccountLinkPage() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-xl flex-col justify-center px-4 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Account migration</p>
      <h1 className="mt-3 text-2xl font-semibold">Finishing account link</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        WorkOS is verifying the account link and restoring your existing profile.
      </p>
    </main>
  );
}
