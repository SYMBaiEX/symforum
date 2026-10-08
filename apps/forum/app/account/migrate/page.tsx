"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AccountMigrationPanel } from "@/components/auth/account-migration-panel";

export default function AccountMigrationPage() {
  return (
    <div className="min-h-[60vh] px-4 py-12">
      <Suspense fallback={<p className="mx-auto max-w-xl text-sm text-muted-foreground">Loading account migration…</p>}>
        <MigrationPanelWithStatus />
      </Suspense>
    </div>
  );
}

function MigrationPanelWithStatus() {
  const params = useSearchParams();
  return <AccountMigrationPanel status={params.get("status") ?? undefined} />;
}
