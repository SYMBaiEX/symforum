import { describe, expect, test } from "vitest";
import { getBase58Decoder } from "@solana/kit";
import {
  communityAmount,
  communityHttpsUrl,
  communityPaymentUrl,
  lamportsToSol,
  solToLamports,
  SYSTEM_PROGRAM,
  verifyCommunityReceipt,
} from "./forum-community";
import { PROMOTION_MEMO_PROGRAM } from "./forum-commerce";

const key = (n: number) =>
  getBase58Decoder().decode(new Uint8Array(32).fill(n));
const signature = getBase58Decoder().decode(new Uint8Array(64).fill(13));
const binding = {
  wallet: key(1),
  recipient: key(2),
  reference: key(3),
  amountLamports: "10000000",
  memo: `SYMF-COMMUNITY:${key(3)}`,
  createdAt: 1_793_400_000_000,
  expiresAt: 1_793_401_800_000,
};
function receipt() {
  return {
    slot: 500,
    blockTime: binding.createdAt / 1000,
    meta: {
      err: null,
      innerInstructions: [],
      preBalances: [1_000_000_000, 100_000_000, 0],
      postBalances: [989_995_000, 110_000_000, 0],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [
          { pubkey: binding.wallet, signer: true },
          { pubkey: binding.recipient, signer: false },
          { pubkey: binding.reference, signer: false },
        ],
        instructions: [
          {
            programId: SYSTEM_PROGRAM,
            parsed: {
              type: "transfer",
              info: {
                source: binding.wallet,
                destination: binding.recipient,
                lamports: 10000000,
              },
            },
          },
          { programId: PROMOTION_MEMO_PROGRAM, parsed: binding.memo },
        ],
      },
    },
  };
}

describe("exact SOL amount parsing", () => {
  test.each([
    [".5", "500000000"],
    ["0.000000001", "1"],
    ["100", "100000000000"],
    ["1.20", "1200000000"],
  ])("converts %s without floating point", (input, raw) => {
    expect(solToLamports(input)).toBe(raw);
    expect(solToLamports(lamportsToSol(raw))).toBe(raw);
  });
  test.each([
    "0",
    "-1",
    "101",
    "1e-5",
    "0.0000000001",
    "1,000",
    "NaN",
    "Infinity",
    "01",
    "  ",
  ])("rejects %s", (input) => expect(() => solToLamports(input)).toThrow());
  test("caps raw reward amounts", () => {
    expect(() => communityAmount("100000000001")).toThrow();
    expect(() => communityAmount("01")).toThrow();
  });
});
test("Solana Pay URL binds exact SOL units, reference and signed memo", () => {
  const url = new URL(communityPaymentUrl(binding));
  expect(url.protocol).toBe("solana:");
  expect(url.pathname).toBe(binding.recipient);
  expect(url.searchParams.get("amount")).toBe("0.01");
  expect(url.searchParams.get("reference")).toBe(binding.reference);
  expect(url.searchParams.get("memo")).toBe(binding.memo);
  expect(url.searchParams.has("spl-token")).toBe(false);
});
test.each([
  "javascript:alert(1)",
  "http://example.org/",
  "https://user:pass@example.org/",
  "https://localhost/",
  "https://127.0.0.1/a",
  "https://example.org:8443/a",
])("rejects unsafe project or deliverable link %s", (input) =>
  expect(() => communityHttpsUrl(input)).toThrow(),
);
test("keeps secure public deliverable links", () =>
  expect(communityHttpsUrl("https://example.org/research?mint=AbC")).toBe(
    "https://example.org/research?mint=AbC",
  ));
test("only a matching successful finalized direct transfer is fulfilled", () => {
  expect(verifyCommunityReceipt(receipt(), binding, signature)).toEqual({
    valid: true,
    issue: "finalized",
    finalizedAt: binding.createdAt,
    slot: 500,
  });
});
test.each([
  [
    "failed transaction",
    (tx: ReturnType<typeof receipt>) => {
      tx.meta.err = { failed: true } as never;
    },
  ],
  [
    "wrong payer",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.accountKeys[0].pubkey = key(6);
    },
  ],
  [
    "unsigned payer",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.accountKeys[0].signer = false;
    },
  ],
  [
    "wrong recipient",
    (tx: ReturnType<typeof receipt>) => {
      const parsed = tx.transaction.message.instructions[0].parsed;
      if (typeof parsed === "object") parsed.info.destination = key(6);
    },
  ],
  [
    "wrong amount",
    (tx: ReturnType<typeof receipt>) => {
      const parsed = tx.transaction.message.instructions[0].parsed;
      if (typeof parsed === "object") parsed.info.lamports = 9999999;
    },
  ],
  [
    "wrong memo",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.instructions[1].parsed = "wrong" as never;
    },
  ],
  [
    "missing reference",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.accountKeys[2].pubkey = key(6);
    },
  ],
  [
    "wrong signature",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.signatures[0] = key(6);
    },
  ],
  [
    "recipient balance not credited",
    (tx: ReturnType<typeof receipt>) => {
      tx.meta.postBalances[1] = tx.meta.preBalances[1];
    },
  ],
  [
    "old payment",
    (tx: ReturnType<typeof receipt>) => {
      tx.blockTime -= 60;
    },
  ],
  [
    "late payment",
    (tx: ReturnType<typeof receipt>) => {
      tx.blockTime = binding.expiresAt / 1000 + 1;
    },
  ],
  [
    "untrusted program",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.instructions.push({
        programId: key(9),
        parsed: "x" as never,
      });
    },
  ],
  [
    "multiple transfers",
    (tx: ReturnType<typeof receipt>) => {
      tx.transaction.message.instructions.push(
        tx.transaction.message.instructions[0],
      );
    },
  ],
  [
    "inner instructions",
    (tx: ReturnType<typeof receipt>) => {
      tx.meta.innerInstructions.push({ index: 0 } as never);
    },
  ],
] as const)("does not fulfill %s", (_label, mutate) => {
  const tx = receipt();
  mutate(tx);
  expect(verifyCommunityReceipt(tx, binding, signature).valid).toBe(false);
});
test("null, malformed, oversized and missing receipt data never prove payment", () => {
  for (const tx of [
    null,
    {},
    { meta: { err: null } },
    {
      ...receipt(),
      transaction: {
        ...receipt().transaction,
        signatures: Array(100).fill(signature),
      },
    },
  ])
    expect(verifyCommunityReceipt(tx, binding, signature).valid).toBe(false);
});
test("unsafe numeric lamports cannot satisfy an exact receipt", () => {
  const tx = receipt(),
    parsed = tx.transaction.message.instructions[0].parsed;
  if (typeof parsed === "object")
    parsed.info.lamports = Number.MAX_SAFE_INTEGER + 1;
  expect(verifyCommunityReceipt(tx, binding, signature).valid).toBe(false);
});
test("missing finalized block time is never a successful payment", () => {
  expect(
    verifyCommunityReceipt(
      { ...receipt(), blockTime: null },
      binding,
      signature,
    ).valid,
  ).toBe(false);
});
test("oversized raw amounts never become payment requests", () => {
  expect(() =>
    communityPaymentUrl({ ...binding, amountLamports: "18446744073709551616" }),
  ).toThrow();
});
