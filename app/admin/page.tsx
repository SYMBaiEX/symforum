import { AdminDashboard } from "@/components/admin-dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="page-frame">
        {configured ? (
          <AdminDashboard />
        ) : (
          <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
            Convex is not connected locally.
          </div>
        )}
      </section>
    </>
  );
}
