import { Suspense } from "react";
import { AccountMigrationPanel } from "@/components/auth/account-migration-panel";

export default async function AccountMigrationPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const { status } = (await searchParams) ?? {};
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <Suspense fallback={<p className="mx-auto max-w-xl text-sm text-muted-foreground">Loading account migration…</p>}>
        <AccountMigrationPanel status={status} />
      </Suspense>
    </main>
  );
}
