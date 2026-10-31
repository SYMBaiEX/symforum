// @vitest-environment node
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Intent = FunctionReturnType<typeof api.forumPromotions.quotePromotion>;
const harness = vi.hoisted(() => ({
  authenticated: false,
  connected: null as unknown,
  mine: [] as unknown[],
  active: null as unknown,
  tokens: [] as unknown[],
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  refCursor: 0,
  layoutEffects: [] as Array<() => void>,
  actions: [] as Array<{
    callback: (...args: unknown[]) => Promise<unknown>;
    dispatch: ReturnType<typeof vi.fn>;
  }>,
  buttons: [] as Array<{ label: string; click?: () => unknown; disabled?: boolean }>,
  reserve: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  hold: vi.fn(),
  begin: vi.fn(),
  resolve: vi.fn(),
  walletRequest: vi.fn(),
  verify: vi.fn(),
  client: { wallet: { getState: vi.fn(), subscribe: vi.fn() } },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: () => {},
  useLayoutEffect: (effect: () => void) => harness.layoutEffects.push(effect),
  useState: <T,>(initial: T | (() => T)) => {
    const index = harness.stateCursor++;
    if (!(index in harness.states))
      harness.states[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    return [
      harness.states[index] as T,
      (next: T | ((current: T) => T)) => {
        harness.states[index] =
          typeof next === "function"
            ? (next as (current: T) => T)(harness.states[index] as T)
            : next;
      },
    ];
  },
  useRef: <T,>(initial: T) => {
    const index = harness.refCursor++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index] as { current: T };
  },
}));
function operation(reference: unknown) {
  return getFunctionName(reference as FunctionReference<"action">);
}
vi.mock("convex/react", () => ({
  useQuery: (reference: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    switch (operation(reference)) {
      case "forumCommerce:resolveThreadTokens": return harness.tokens;
      case "forumCommerce:getThreadMint": return null;
      case "forumPostTokens:status": return null;
      case "forumCommerce:getConfig": return { promotionsEnabled: true, promotionAmountRaw: "10000000000" };
      case "forumPromotions:getPromotion": return harness.active;
      case "forumPromotions:listMine": return harness.mine;
      default: throw new Error("Unexpected query in isolated promotion test");
    }
  },
  useAction: (reference: unknown) => {
    switch (operation(reference)) {
      case "forumPromotions:quotePromotion": return harness.reserve;
      case "forumPromotions:prepare": return harness.prepare;
      case "forumPromotions:submitPromotion": return harness.submit;
      case "forumCommerce:resolveMint": return harness.resolve;
      default: throw new Error("Unexpected action in isolated promotion test");
    }
  },
  useMutation: (reference: unknown) => {
    switch (operation(reference)) {
      case "forumPromotions:markUnknown": return harness.hold;
      case "forumPromotions:beginWalletRequest": return harness.begin;
      default: throw new Error("Unexpected mutation in isolated promotion test");
    }
  },
  useConvexAuth: () => ({ isAuthenticated: harness.authenticated }),
}));
vi.mock("@solana/react", () => ({
  useAction: (callback: (...args: unknown[]) => Promise<unknown>) => {
    const dispatch = vi.fn((...args: unknown[]) =>
      callback(new AbortController().signal, ...args),
    );
    harness.actions.push({ callback, dispatch });
    return { dispatch, isRunning: false };
  },
}));
vi.mock("@solana/kit-plugin-wallet/react", () => ({
  useConnectedWallet: () => harness.connected,
}));
vi.mock("./commerce-wallet", () => ({
  CommerceWalletProvider: ({ children }: { children: ReactNode }) => children,
  CommerceWalletButton: () => <p>Promotion wallet connection</p>,
  useCommerceWallet: () => harness.client,
}));
vi.mock("@/components/forum/forum-runtime-context", () => ({
  useForumRuntime: () => ({ host: "website" }),
}));
vi.mock("@/lib/commerce-wallet-client", () => ({
  requestReviewedTransaction: harness.walletRequest,
  verifyPreparedTransaction: harness.verify,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: ComponentProps<"button">) => {
    harness.buttons.push({ label: String(children), click: onClick as (() => unknown) | undefined, disabled });
    return <button disabled={disabled}>{children}</button>;
  },
}));
vi.mock("./token-swap", () => ({ TokenSwap: () => <p>Token swap retained</p> }));
vi.mock("@/components/community/community-hub", () => ({ AuthorTip: () => <p>Author tip retained</p> }));
vi.mock("@/components/forum/forum-link", () => ({
  ForumLink: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("./promotion-calendar", () => ({ PromotionCalendar: () => <div>Promotion calendar</div> }));
import { ForumCommerceFrame } from "./forum-commerce";

const threadId = "thread-one" as Id<"forumThreads">;
function receipt(): Intent {
  return {
    intentId: "intent-one" as Id<"forumPromotionIntents">,
    wallet: "wallet-one",
    threadId,
    categorySlug: "research",
    treasury: "treasury-one",
    mint: "mint-one",
    tokenProgram: "program-one",
    decimals: 6,
    amountRaw: "10000000000",
    treasuryAmountRaw: "5000000000",
    burnAmountRaw: "5000000000",
    reference: "reference-one",
    checkoutExpiresAt: Date.now() + 60_000,
    startsAt: Date.now(),
    endsAt: Date.now() + 86_400_000,
    status: "held",
    signature: "known-receipt-signature",
    issue: null,
    prepared: true,
  };
}
function render(readOnlyArchive = false) {
  harness.stateCursor = 0;
  harness.refCursor = 0;
  harness.actions = [];
  harness.buttons = [];
  harness.layoutEffects = [];
  const html = renderToStaticMarkup(
    <ForumCommerceFrame threadId={threadId} readOnlyArchive={readOnlyArchive}>
      <article>Archived discussion stays readable</article>
    </ForumCommerceFrame>,
  );
  for (const effect of harness.layoutEffects) effect();
  return html;
}
function assertNoNewPayment() {
  expect(harness.reserve).not.toHaveBeenCalled();
  expect(harness.prepare).not.toHaveBeenCalled();
  expect(harness.begin).not.toHaveBeenCalled();
  expect(harness.walletRequest).not.toHaveBeenCalled();
}
function seedLocalIntent() {
  render();
  // ThreadCommerce owns the first state; LivePromotion owns the rest.
  harness.states[1] = receipt();
  harness.states[2] = { estimatedNetworkFeeLamports: "5000" };
  harness.states[3] = true;
  harness.states[6] = "known-receipt-signature";
  return render();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.authenticated = false;
  harness.connected = null;
  harness.mine = [];
  harness.active = null;
  harness.tokens = [];
  harness.states = [];
  harness.refs = [];
});

test("active boards retain the normal promotion invitation without dispatching on mount", () => {
  const html = render();
  expect(html).toContain("Promote this post");
  expect(html).toContain("Promotion calendar");
  expect(html).toContain("Promotion wallet connection");
  expect(html).toContain("to sponsor a post");
  expect(harness.actions.every((action) => action.dispatch.mock.calls.length === 0)).toBe(true);
  assertNoNewPayment();
});

test.each([false, true])("an archived reader sees no promotion invitation while swaps and tips remain (authenticated %s)", (authenticated) => {
  harness.authenticated = authenticated;
  harness.tokens = [{ mint: "token-one", symbol: "TOKEN" }];
  const html = render(true);
  expect(html).toContain("Archived discussion stays readable");
  expect(html).toContain("Token swap retained");
  expect(html).toContain("Author tip retained");
  expect(html).not.toContain('id="promote-post"');
  expect(html).not.toContain("Promotion wallet connection");
  expect(html).not.toContain("Promotion calendar");
  expect(harness.actions.every((action) => action.dispatch.mock.calls.length === 0)).toBe(true);
  assertNoNewPayment();
});

test("archived owners retain held receipt history and checks, not prices or payment controls", async () => {
  harness.authenticated = true;
  const row = receipt();
  harness.mine = [row];
  const html = render(true);
  expect(html).toContain("Promotion receipts");
  expect(html).toContain("Your promotion receipts for this post");
  expect(html).toContain("held");
  expect(html).toContain("Check receipt");
  for (const text of ["Promote this post", "Promotion calendar", "commerce-promotion-price", "Prepare and simulate", "Pay and burn in wallet", "Promotion wallet connection", "to sponsor a post", "50% is burned"])
    expect(html).not.toContain(text);
  expect(harness.submit).not.toHaveBeenCalled();
  harness.submit.mockResolvedValueOnce(row);
  await harness.buttons.find((button) => button.label === "Check receipt")?.click?.();
  expect(harness.submit).toHaveBeenCalledExactlyOnceWith({
    intentId: row.intentId,
    signature: row.signature,
  });
  assertNoNewPayment();
});

test("archiving preserves local intent, sent state and signature recovery without a pay action", () => {
  harness.authenticated = true;
  seedLocalIntent();
  harness.states[7] = true;
  const html = render(true);
  expect(html).toContain("Existing promotion status");
  expect(html).toContain("held");
  expect(html).toContain("known-receipt-signature");
  expect(html).toContain("Check receipt without resending");
  expect(html).not.toContain("Pay and burn in wallet");
  expect(html).not.toContain("Prepare and simulate");
  expect(harness.states[1]).toMatchObject({
    intentId: "intent-one",
    status: "held",
    signature: "known-receipt-signature",
  });
  expect(harness.states[7]).toBe(true);
  assertNoNewPayment();
});

test("callbacks from the active render cannot quote, prepare or pay after the board is archived", async () => {
  harness.authenticated = true;
  harness.connected = { account: { address: "wallet-one" }, supportedTransactionVersions: new Set([0]) };
  seedLocalIntent();
  const stale = harness.actions.slice();
  render(true);
  // Actions zero to two are the promotion quote, preparation and payment.
  for (const action of stale.slice(0, 3))
    await action.callback(new AbortController().signal);
  assertNoNewPayment();
  expect(harness.submit).not.toHaveBeenCalled();
});

test("archiving during authorization prevents the wallet request and retains the protected intent", async () => {
  harness.authenticated = true;
  harness.connected = { account: { address: "wallet-one" }, supportedTransactionVersions: new Set([0]) };
  seedLocalIntent();
  let finish!: () => void;
  harness.begin.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = harness.actions[2].callback(new AbortController().signal);
  expect(harness.begin).toHaveBeenCalledTimes(1);
  render(true);
  finish();
  await pending;
  const html = render(true);
  expect(harness.walletRequest).not.toHaveBeenCalled();
  expect(harness.submit).not.toHaveBeenCalled();
  expect(harness.hold).not.toHaveBeenCalled();
  expect(html).toContain("Existing promotion status");
  expect(html).toContain("Check receipt without resending");
  expect(harness.states[7]).toBe(true);
});
