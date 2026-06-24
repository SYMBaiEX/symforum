import { AdminDashboard } from "@/components/admin-dashboard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
};

export default function AdminPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <>
      <section className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-16">
        <div className="mb-8 border-y border-row-border py-5">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Owner console
          </p>
          <h1 className="mt-3 text-5xl font-bold leading-none md:text-7xl">
            Admin dashboard
          </h1>
        </div>
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
