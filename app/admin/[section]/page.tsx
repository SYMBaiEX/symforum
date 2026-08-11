import { AdminDashboard } from "@/components/admin-dashboard";
import { isAdminSectionId } from "@/lib/admin-sections";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type AdminSectionPageProps = {
  params: Promise<{ section: string }>;
};

export async function generateMetadata({
  params,
}: AdminSectionPageProps): Promise<Metadata> {
  const { section } = await params;
  if (!isAdminSectionId(section) || section === "overview") {
    return { title: "Admin", robots: { index: false, follow: false } };
  }
  return {
    title: `${section === "ai" ? "AI" : titleCase(section)} | Admin`,
    robots: { index: false, follow: false },
  };
}

export default async function AdminSectionPage({
  params,
}: AdminSectionPageProps) {
  const { section } = await params;
  if (!isAdminSectionId(section) || section === "overview") notFound();

  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  return (
    <section className="page-frame">
      {configured ? (
        <AdminDashboard initialTab={section} />
      ) : (
        <div className="border-y border-row-border py-6 font-mono text-xs uppercase text-muted-foreground">
          Convex is not connected locally.
        </div>
      )}
    </section>
  );
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
