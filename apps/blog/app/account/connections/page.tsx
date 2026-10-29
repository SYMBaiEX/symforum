import { IdentityConnections } from "@/components/auth/identity-connections";
export const metadata = { title: "Account connections", robots: { index: false, follow: false } };
export default function AccountConnectionsPage() {
  return <main className="page-frame mx-auto max-w-2xl py-8"><IdentityConnections /></main>;
}
