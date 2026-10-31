// Invented records; every write, payment action and wallet request is forbidden.
import { useCallback, type ReactNode, type ComponentProps } from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { CommerceWalletClient } from "../../../lib/commerce-wallet-client";
const mint = "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump";
const wallet = "11111111111111111111111111111111";
export const forbidden: string[] = [];
export const reads: string[] = [];
export const fixturePayment = {
  intentId: "fixture-held-intent",
  wallet: mint,
  recipient: mint,
  amountLamports: "10000000",
  purpose: "tip",
  reference: wallet,
  memo: "Fixture metadata only",
  createdAt: 1,
  expiresAt: 1793500000000,
  status: "held",
  signature: null,
  issue: "fixture_protected",
  finalizedAt: null,
  workId: null,
};
export function useConvexAuth() {
  return { isAuthenticated: true, isLoading: false };
}
export function useQuery(reference: FunctionReference<"query">, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  reads.push(name);
  if (name === "forumCommunity:listProjects")
    return [
      {
        projectId: "fixture-project",
        mint,
        name: "A long project title that remains readable in the community directory",
        symbol: "LONGDEMO",
        claims: [
          {
            userId: "fixture-reader",
            username: "long_builder_name_with_32_letters",
            role: "r".repeat(60),
            description: `Source-backed community project notes. ${"x".repeat(180)}`,
            website: "https://example.com/",
          },
        ],
      },
    ];
  if (name === "forumCommunity:getMine")
    return {
      userId: "fixture-reader",
      recipient: { wallet: mint, accepting: true },
      supporter: null,
    };
  if (name === "forumCommunity:listBounties")
    return (args as { status: string }).status === "open"
      ? [
          {
            workId: "fixture-work",
            sponsorId: "fixture-reader",
            sponsor: "long_builder_name_with_32_letters",
            mint,
            kind: "research",
            title: "A useful research brief with a long but valid title",
            brief: `Explain and verify this invented task. ${"v".repeat(120)}`,
            amountLamports: "10000000",
            status: "open",
            selectedSubmissionId: null,
            updatedAt: 1,
          },
        ]
      : [];
  if (name === "forumCommunity:listSubmissions") return [];
  if (name === "forumCommunity:listTipRecipients")
    return [
      {
        userId: "fixture-recipient",
        username: "long_builder_name_with_32_letters",
        wallet: mint,
      },
    ];
  if (name === "forumCommunity:listPayments") return [fixturePayment];
  if (name === "forumCommunity:getPayment") return fixturePayment;
  throw new Error(`Unexpected read: ${name}`);
}
function useForbidden(
  reference: FunctionReference<"action"> | FunctionReference<"mutation">,
) {
  const name = getFunctionName(reference);
  return useCallback(async () => {
    forbidden.push(name);
    throw new Error(
      "Financial or write action forbidden in responsive fixture",
    );
  }, [name]);
}
export const useAction = useForbidden;
export const useMutation = useForbidden;
const client = new Proxy(
  {},
  {
    get() {
      forbidden.push("wallet");
      throw new Error("Wallet unavailable in responsive fixture");
    },
  },
) as CommerceWalletClient;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  return children;
}
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  return {
    isAuthenticated: true,
    isLoading: false,
    linked: true,
    connected: { account: { address: wallet } },
    session: { authUserId: "fixture-reader", wallets: [wallet] },
  };
}
export function CommerceWalletButton() {
  return (
    <button
      type="button"
      onClick={() => {
        forbidden.push("wallet-connect");
        throw new Error("Wallet not allowed");
      }}
    >
      Community wallet
    </button>
  );
}
export function usePathname() {
  return "/community";
}
export function ForumLink({
  prefetch: _prefetch,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean }) {
  return <a {...props} />;
}
