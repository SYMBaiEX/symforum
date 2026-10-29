import { AgentRegistrationClaim } from "@/components/auth/agent-registration-claim";
export const metadata = { title: "Claim your agent", robots: { index: false, follow: false } };
export default function AgentClaimPage() {
  return <main className="page-frame mx-auto max-w-2xl py-8"><AgentRegistrationClaim /></main>;
}
