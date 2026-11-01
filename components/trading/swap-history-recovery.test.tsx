import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: undefined as unknown,
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (reference: unknown, args: unknown) => {
    state.query(reference, args);
    if (state.rows instanceof Error) throw state.rows;
    return state.rows;
  },
  useAction: () => {
    throw new Error("No action belongs to the history reader");
  },
}));
import { SwapHistory } from "./wallet-panel";
const held = {
  quoteId: "invented-held",
  status: "held",
  signature: "1".repeat(88),
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "5UJkWhgLxiZZoCbcN4NfqacmrtAPKNxwa17Puv4zpump",
  createdAt: 1793520000000,
};
beforeEach(() => {
  state.rows = undefined;
  state.query.mockClear();
});
test("missing owner never queries or renders retained private content", () => {
  state.rows = [held];
  const html = renderToStaticMarkup(<SwapHistory ownerId={null} />);
  expect(state.query).not.toHaveBeenCalled();
  expect(html).toContain("Confirming your account");
  expect(html).not.toContain(held.signature);
  expect(html).not.toContain("No swap operations");
});
test("a verified owner retains the original one-query empty argument contract", () => {
  renderToStaticMarkup(<SwapHistory ownerId="invented-owner" />);
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(state.query.mock.calls[0][1]).toEqual({});
});
test("an unresolved query is loading rather than an invented empty ledger", () => {
  const html = renderToStaticMarkup(<SwapHistory ownerId="invented-owner" />);
  expect(html).toContain("Loading your operation receipts");
  expect(html).not.toContain("No swap operations");
});
test("a confirmed empty loaded window retains the original safety explanation", () => {
  state.rows = [];
  const html = renderToStaticMarkup(<SwapHistory ownerId="invented-owner" />);
  expect(html).toContain("No swap operations on this account yet");
  expect(html).toContain("does not move funds");
});
test("original statuses, signatures and absent-signature text are not rewritten", () => {
  state.rows = [
    held,
    {
      ...held,
      quoteId: "invented-submitted",
      status: "submitted",
      signature: null,
    },
  ];
  const html = renderToStaticMarkup(<SwapHistory ownerId="invented-owner" />);
  expect(html).toContain("Outcome protected");
  expect(html).toContain("Submitted");
  expect(html).toContain(`https://solscan.io/tx/${held.signature}`);
  expect(html).toContain("No signature recorded");
});
test("read exceptions are not converted into confirmed-empty records", () => {
  state.rows = new Error("Invented failure");
  expect(() =>
    renderToStaticMarkup(<SwapHistory ownerId="invented-owner" />),
  ).toThrow("Invented failure");
});
