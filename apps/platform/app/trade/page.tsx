import { redirect } from "next/navigation";
import { terminalRedirectForMint } from "@/lib/terminal-selection";

export default async function TradeRedirect({
  searchParams,
}: {
  searchParams: Promise<{ mint?: string | string[] }>;
}) {
  redirect(terminalRedirectForMint((await searchParams).mint));
}
