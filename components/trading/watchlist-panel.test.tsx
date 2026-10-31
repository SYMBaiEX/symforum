import type { ButtonHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { TokenAlert, WatchToken } from "./terminal-api";

const state = vi.hoisted(() => ({
  alerts: [] as TokenAlert[],
  watches: [] as WatchToken[],
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  save: vi.fn(),
  acknowledge: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "forumTerminal:listAlerts"
      ? state.alerts
      : state.watches,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "forumTerminal:acknowledgeAlert"
      ? state.acknowledge
      : state.save,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    state.buttons.push(props);
    return <button data-variant={variant} {...props} />;
  },
}));

import { WatchlistPanel } from "./watchlist-panel";

const selected = {
  mint: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  name: "Selected Solana token",
};
const alertMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const alert: TokenAlert = {
  id: "alert-fixture",
  mint: alertMint,
  symbol: "SAME",
  direction: "above",
  thresholdUsd: 0.5,
  priceUsd: 0.6,
  observedAt: 1_800_000_000_000,
  acknowledged: false,
};

beforeEach(() => {
  state.alerts = [alert];
  state.watches = [];
  state.buttons = [];
  state.save.mockReset();
  state.acknowledge.mockReset();
  state.acknowledge.mockResolvedValue(null);
});

test("an unread alert names its exact mint and selects it without acknowledging or saving", () => {
  const onSelect = vi.fn();
  const html = renderToStaticMarkup(
    <WatchlistPanel selected={selected} onSelect={onSelect} />,
  );
  expect(html).toContain(`title="${alertMint}"`);
  const view = state.buttons.find(
    (button) =>
      button["aria-label"] === `View token for alert, mint ${alertMint}`,
  );
  expect(view).toMatchObject({ type: "button", disabled: false });
  view?.onClick?.({} as never);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    mint: alertMint,
    symbol: "SAME",
    name: "Alerted Solana token",
  });
  expect(state.acknowledge).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

test("identical symbols retain distinct exact-mint actions and mark read stays separate", () => {
  state.alerts.push({ ...alert, id: "second-alert", mint: selected.mint });
  const onSelect = vi.fn();
  renderToStaticMarkup(
    <WatchlistPanel selected={selected} onSelect={onSelect} />,
  );
  expect(
    state.buttons.find(
      (button) =>
        button["aria-label"] ===
        `Selected token for alert, mint ${selected.mint}`,
    ),
  ).toMatchObject({ disabled: true, children: "Selected" });
  const markRead = state.buttons.filter(
    (button) => button.children === "Mark read",
  );
  expect(markRead).toHaveLength(2);
  markRead[0].onClick?.({} as never);
  expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith({ id: alert.id });
  expect(onSelect).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

test("acknowledged alerts have no action and missing symbols cannot change mint identity", () => {
  state.alerts = [
    { ...alert, acknowledged: true },
    { ...alert, id: "missing-symbol", mint: selected.mint, symbol: null },
  ];
  const onSelect = vi.fn();
  const html = renderToStaticMarkup(
    <WatchlistPanel
      selected={{ ...selected, mint: alertMint }}
      onSelect={onSelect}
    />,
  );
  expect(html).not.toContain(`View token for alert, mint ${alertMint}`);
  const view = state.buttons.find(
    (button) =>
      button["aria-label"] === `View token for alert, mint ${selected.mint}`,
  );
  view?.onClick?.({} as never);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ mint: selected.mint }),
  );
  expect(state.acknowledge).not.toHaveBeenCalled();
});

test("saved threshold readings preserve full stored precision and ordinary cents", () => {
  state.watches = [
    {
      mint: selected.mint,
      symbol: "SOL",
      priceAboveUsd: 0.1234567890123456,
      priceBelowUsd: 0.0000000123456789,
      updatedAt: 1,
    },
  ];
  const html = renderToStaticMarkup(
    <WatchlistPanel selected={selected} onSelect={vi.fn()} />,
  );
  expect(html).toContain("$0.1234567890123456");
  expect(html).toContain("$0.0000000123456789");
  state.watches[0].priceAboveUsd = 0.5;
  expect(
    renderToStaticMarkup(
      <WatchlistPanel selected={selected} onSelect={vi.fn()} />,
    ),
  ).toContain("$0.50");
});

test("threshold clear controls stage drafts without a mutation", () => {
  state.watches = [
    {
      mint: selected.mint,
      symbol: "SOL",
      priceAboveUsd: 10,
      priceBelowUsd: 5,
      updatedAt: 1,
    },
  ];
  const html = renderToStaticMarkup(
    <WatchlistPanel selected={selected} onSelect={vi.fn()} />,
  );
  expect(html).toContain(
    "Clear actions only change this draft; save to apply them.",
  );
  for (const label of ["Clear above", "Clear below", "Clear thresholds"]) {
    const clear = state.buttons.find((button) => button.children === label);
    expect(clear).toMatchObject({ type: "button", disabled: false });
    clear?.onClick?.({} as never);
  }
  expect(state.save).not.toHaveBeenCalled();
  expect(state.acknowledge).not.toHaveBeenCalled();
});
