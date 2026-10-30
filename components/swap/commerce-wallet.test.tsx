// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { CommerceWalletClient } from "@/lib/commerce-wallet-client";

type Account = {
  address: string;
  chains: string[];
  features: string[];
};
const state = vi.hoisted(() => {
  const selectAccount = vi.fn();
  const connect = vi.fn();
  const disconnect = vi.fn();
  return {
    authenticated: true,
    session: { authUserId: "owner", wallets: ["linked-account"] } as
      { authUserId: string; wallets: string[] } | undefined,
    wallets: [] as { name: string; features: string[]; accounts: Account[] }[],
    connected: null as { account: Account } | null,
    status: "disconnected",
    effects: [] as (() => void)[],
    selectAccount,
    connect,
    disconnect,
    client: { wallet: { selectAccount, disconnect } },
  };
});
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // SSR gives this suite a hook harness without a browser or wallet extension.
    useEffect: (effect: () => void) => state.effects.push(effect),
  };
});
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: state.authenticated,
    isLoading: false,
  }),
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" ? undefined : state.session,
}));
vi.mock("@solana/kit-plugin-wallet/react", () => ({
  useConnectedWallet: () => state.connected,
  useWallets: () => state.wallets,
  useWalletStatus: () => state.status,
  useConnect: () => ({
    dispatchAsync: state.connect,
    isRunning: false,
    error: null,
  }),
}));
vi.mock("@/components/auth/solana-wallet-provider", () => ({
  useSessionWalletClient: () => state.client,
  SolanaWalletBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/auth/wallet-signin", () => ({
  WalletSignIn: ({ purpose, label }: { purpose: string; label: string }) => (
    <p>{`${purpose}: ${label}`}</p>
  ),
}));
vi.mock("@/components/ui/dialog", () => {
  const component = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: component,
    DialogContent: component,
    DialogHeader: component,
    DialogTitle: component,
    DialogDescription: component,
    DialogTrigger: component,
  };
});

import {
  CommerceWalletButton,
  useCommerceIdentity,
  type CommerceWalletFeature,
} from "./commerce-wallet";

function account(
  feature = "solana:signTransaction",
  address = "linked-account",
  chain = "solana:mainnet",
): Account {
  return { address, chains: [chain], features: [feature] };
}
function renderIdentity(requiredFeature?: CommerceWalletFeature) {
  let result: ReturnType<typeof useCommerceIdentity> | undefined;
  function Identity() {
    result = useCommerceIdentity(
      state.client as unknown as CommerceWalletClient,
      requiredFeature,
    );
    return null;
  }
  renderToStaticMarkup(<Identity />);
  return result!;
}
function flushEffects() {
  for (const effect of state.effects) effect();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.authenticated = true;
  state.session = { authUserId: "owner", wallets: ["linked-account"] };
  state.wallets = [];
  state.connected = null;
  state.status = "disconnected";
  state.effects = [];
});

test("signature-first flow restores a uniquely exposed linked sign-only account without connecting", () => {
  const selected = account();
  state.wallets = [
    { name: "Sign only", features: selected.features, accounts: [selected] },
  ];
  renderIdentity("solana:signTransaction");
  flushEffects();
  flushEffects();
  expect(state.selectAccount).toHaveBeenCalledExactlyOnceWith(selected);
  expect(state.connect).not.toHaveBeenCalled();
});

test("legacy and promotion restoration still require sign-and-send by default", () => {
  const selected = account();
  state.wallets = [
    { name: "Sign only", features: selected.features, accounts: [selected] },
  ];
  renderIdentity();
  flushEffects();
  expect(state.selectAccount).not.toHaveBeenCalled();
  expect(state.connect).not.toHaveBeenCalled();
});

test("default restoration still accepts a linked sign-and-send account", () => {
  const selected = account("solana:signAndSendTransaction");
  state.wallets = [
    { name: "Send wallet", features: selected.features, accounts: [selected] },
  ];
  renderIdentity();
  flushEffects();
  expect(state.selectAccount).toHaveBeenCalledExactlyOnceWith(selected);
});

test.each([
  [account("solana:signTransaction", "unlinked-account")],
  [account("solana:signTransaction", "linked-account", "solana:devnet")],
  [account("solana:signAndSendTransaction")],
  [account(), account()],
])(
  "restoration refuses unlinked, wrong-chain, wrong-feature or ambiguous accounts: %j",
  (...accounts) => {
    state.wallets = [{ name: "Wallet", features: [], accounts }];
    renderIdentity("solana:signTransaction");
    flushEffects();
    expect(state.selectAccount).not.toHaveBeenCalled();
    expect(state.connect).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  "owner boundary remains intact, authenticated=%s",
  (authenticated) => {
    state.authenticated = authenticated;
    state.connected = {
      account: account("solana:signTransaction", "unlinked-account"),
    };
    const identity = renderIdentity("solana:signTransaction");
    flushEffects();
    expect(identity.linked).toBe(false);
    expect(state.selectAccount).not.toHaveBeenCalled();
    expect(state.connect).not.toHaveBeenCalled();
  },
);

test("changing the required feature never silently replaces a connected account", () => {
  state.connected = { account: account("solana:signAndSendTransaction") };
  state.wallets = [
    {
      name: "Sign only",
      features: ["solana:signTransaction"],
      accounts: [account()],
    },
  ];
  expect(renderIdentity("solana:signTransaction").linked).toBe(true);
  flushEffects();
  expect(state.selectAccount).not.toHaveBeenCalled();
  expect(state.connect).not.toHaveBeenCalled();
});

test.each(["solana:signTransaction", "solana:signAndSendTransaction"] as const)(
  "wallet picker filters its explicit %s requirement",
  (requiredFeature) => {
    state.wallets = [
      {
        name: "Sign-only wallet",
        features: ["solana:signTransaction"],
        accounts: [],
      },
      {
        name: "Send-only wallet",
        features: ["solana:signAndSendTransaction"],
        accounts: [],
      },
    ];
    const html = renderToStaticMarkup(
      <CommerceWalletButton requiredFeature={requiredFeature} />,
    );
    expect(html).toContain(
      requiredFeature === "solana:signTransaction"
        ? "Sign-only wallet"
        : "Send-only wallet",
    );
    expect(html).not.toContain(
      requiredFeature === "solana:signTransaction"
        ? "Send-only wallet"
        : "Sign-only wallet",
    );
    expect(state.connect).not.toHaveBeenCalled();
  },
);

test("default picker excludes sign-only wallets and still requires login or linking", () => {
  state.wallets = [
    {
      name: "Sign-only wallet",
      features: ["solana:signTransaction"],
      accounts: [],
    },
    {
      name: "Send-only wallet",
      features: ["solana:signAndSendTransaction"],
      accounts: [],
    },
  ];
  expect(renderToStaticMarkup(<CommerceWalletButton />)).not.toContain(
    "Sign-only wallet",
  );
  expect(renderToStaticMarkup(<CommerceWalletButton />)).toContain(
    "Send-only wallet",
  );
  state.session = { authUserId: "owner", wallets: [] };
  expect(
    renderToStaticMarkup(
      <CommerceWalletButton requiredFeature="solana:signTransaction" />,
    ),
  ).toContain("link: Link wallet to trade");
  state.authenticated = false;
  expect(
    renderToStaticMarkup(
      <CommerceWalletButton requiredFeature="solana:signTransaction" />,
    ),
  ).toContain("login: Sign in with wallet");
  expect(state.connect).not.toHaveBeenCalled();
});
