// Inert fixture seams only. No wallet, provider or financial operation is available.
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { getFunctionName, type FunctionReference } from "convex/server";
import { SYMF_TOKEN } from "../../../lib/symf-token";
const flags = new URLSearchParams(location.search);
const subscribers = new Set<() => void>();
let theme = flags.get("theme") === "light" ? "light" : "dark";
export const fixture = {
  reads: [] as { name: string; args: unknown }[],
  actions: [] as string[],
  providerMounts: 0,
  providerUnmounts: 0,
  swapMounts: 0,
  swapUnmounts: 0,
  outputs: [] as unknown[],
  markets: [] as unknown[],
  setTheme(value: "light" | "dark") {
    theme = value;
    document.documentElement.className = value;
    subscribers.forEach((notify) => notify());
  },
};
const push = history.pushState.bind(history);
history.pushState = (...args) => {
  push(...args);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
export function useSearchParams() {
  useSyncExternalStore(subscribe, () => location.href);
  return new URLSearchParams(location.search);
}
export function usePathname() {
  useSyncExternalStore(subscribe, () => location.href);
  return location.pathname;
}
export function useTheme() {
  const current = useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    () => theme,
  );
  return { theme: current, resolvedTheme: current, setTheme: fixture.setTheme };
}
export function useConvexAuth() {
  return {
    isAuthenticated: !flags.has("guest"),
    isLoading: flags.has("auth-loading"),
  };
}
const empty: never[] = [];
const mine = { userId: "fixture-owner", recipient: null, supporter: null };
const project = {
  projectId: "fixture-symf-project",
  mint: SYMF_TOKEN.mint,
  name: SYMF_TOKEN.name,
  symbol: SYMF_TOKEN.symbol,
  claims: [
    {
      userId: "fixture-owner",
      username: "fixture-builder",
      role: "Platform builder / maintainer",
      description:
        "Invented local affiliation. Public project description only.",
      website: "https://forum.symbaiex.com",
    },
  ],
};
export function useQuery(ref: FunctionReference<"query">, args: unknown) {
  const name = getFunctionName(ref),
    signature = JSON.stringify(args);
  useEffect(() => {
    if (signature !== '"skip"')
      fixture.reads.push({ name, args: JSON.parse(signature) });
  }, [name, signature]);
  if (args === "skip") return undefined;
  if (flags.has("native")) throw Error("Native view cannot read backend");
  if (name === "forumCommunity:listProjectPage")
    return flags.has("directory-loading")
      ? undefined
      : { page: [project], isDone: true, continueCursor: "" };
  if (name === "forumCommunity:getMine") return mine;
  if (name === "forumTerminal:getMarket") return null;
  if (name === "forumCommerce:getConfig")
    return {
      swapsEnabled: true,
      signatureFirstEnabled: true,
      managedEnabled: true,
      platformFeeBps: 50,
    };
  if (name === "forumCommerce:searchTokens")
    return [
      {
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        decimals: 9,
        tokenProgram: SYMF_TOKEN.tokenProgram,
      },
      {
        mint: SYMF_TOKEN.mint,
        symbol: SYMF_TOKEN.symbol,
        name: SYMF_TOKEN.name,
        decimals: SYMF_TOKEN.decimals,
        tokenProgram: SYMF_TOKEN.tokenProgram,
      },
    ];
  if (name === "forumSwaps:listMine") return empty;
  if (
    [
      "forumCommunity:listBounties",
      "forumCommunity:listTipRecipients",
      "forumCommunity:listPayments",
    ].includes(name)
  )
    return empty;
  if (name === "forum:search")
    return {
      threads: empty,
      replies: empty,
      pagination: { page: 1, pageSize: 6, totalPages: 1, totalItems: 0 },
      threadPagination: { page: 1, totalPages: 1 },
      replyPagination: { page: 1, totalPages: 1 },
    };
  throw Error(`Unexpected fixture read: ${name}`);
}
const queryClient = {
  query: async (ref: FunctionReference<"query">, args: unknown) => {
    const name = getFunctionName(ref);
    if (name !== "forum:search")
      throw Error(`Unexpected imperative read: ${name}`);
    fixture.reads.push({ name, args });
    return {
      threads: empty,
      replies: empty,
      pagination: { page: 1, pageSize: 6, totalPages: 1, totalItems: 0 },
      threadPagination: { page: 1, totalPages: 1 },
      replyPagination: { page: 1, totalPages: 1 },
    };
  },
};
export function useConvex() {
  return queryClient;
}
export function useMutation(ref: FunctionReference<"mutation">) {
  return async () => {
    fixture.actions.push(getFunctionName(ref));
    throw Error("All fixture writes denied");
  };
}
export const useAction = useMutation;
export function CommerceWalletProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    fixture.providerMounts++;
    return () => {
      fixture.providerUnmounts++;
    };
  }, []);
  return children;
}
const client = { wallet: { getState: () => ({ connected: null }) } };
export function useCommerceWallet() {
  return client;
}
export function useCommerceIdentity() {
  return { ...useConvexAuth(), linked: false, connected: null, session: null };
}
export function CommerceWalletButton() {
  return <button type="button">Inert linked wallet control</button>;
}
export function TokenDetail({
  token,
  now,
}: {
  token: { mint: string };
  now: number;
}) {
  useEffect(() => {
    fixture.markets.push({ token, now });
  }, [token, now]);
  if (flags.has("market-error")) throw Error("Inert market read failure");
  return (
    <section aria-label="Inert shared market workspace">
      <h2>Shared stats and chart</h2>
      <p>
        {flags.has("market-loading")
          ? "Shared chart is loading"
          : "Retained market sample · stale warning"}
      </p>
      <dl>
        <dt>Price USD</dt>
        <dd>Fixture value only</dd>
      </dl>
      <div style={{ minHeight: 240 }}>Inert chart transport: no request</div>
    </section>
  );
}
export function TokenSwap({ outputToken }: { outputToken: unknown }) {
  const [amount, setAmount] = useState("");
  useEffect(() => {
    fixture.outputs.push(outputToken);
    fixture.swapMounts++;
    return () => {
      fixture.swapUnmounts++;
    };
  }, [outputToken]);
  return (
    <section aria-label="Inert native swap">
      <label>
        Inert swap amount
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <p>Protected fixture attempt retained</p>
    </section>
  );
}
export default function Link({
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) {
  return <a {...props} />;
}
