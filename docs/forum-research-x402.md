# Explicit Solana research exports

This is a separate opt-in product. Ordinary browsing, posting, search and
existing free-beta API routes remain free. A quote freezes the complete sourced
report before payment; fulfillment performs no new model call or paid research
job. A report is a timestamped export, not investment advice or a safety badge.

## Product and readiness

- Catalog: `GET /api/research/catalog`.
- `solana-token-brief-v1`: exactly 100000 base units of mainnet USDC ($0.10).
- SDKs: `@x402/core` and `@x402/svm` 2.29.0, Kit 8.6, x402 V2 exact.
- Facilitator: public PayAI, v0 only until a compatible version is advertised.
- Required before enabling: actual verified provider starter-credit balance,
  supported exact-mainnet capability and initialized treasury USDC ATA.
- The operator runs internal `forumResearchActions.verifyReadiness` only after
  target-specific deployment approval and dashboard verification. Credit limit
  is at most 1000 initial credits, can only decrease, and never renews. Reserve
  two credits before every settlement. No account upgrades or credit top-ups.
- Cached readiness refreshes automatically on a new quote after an hour, under
  one bounded lease and the unchanged shared commerce network allowance.

No readiness row means disabled. The UI clearly distinguishes setup/exhaustion
from an available product. Readiness is not proof that a real payment succeeded.

## Authentication and exact payment

Current purchase authorization requires a human Better Auth session and a wallet
already verified/linked to that account. Owner-directed API clients may send the
same owner session JWT in `Authorization: Bearer ...`. Registered agents' existing
evidence-only grants do **not** authorize spending an owner's wallet. Autonomous
agent payment delegation is intentionally not claimed by this release.

1. Explicitly request a quote with `POST /api/research/token`, JSON
   `{wallet,mint,idempotencyKey}`. It returns HTTP402 and `PAYMENT-REQUIRED`.
2. Decode the declaration with the official SDK. Check exact USDC, amount,
   treasury, version, resource identity and intent memo. The server's saved
   intent binds the requested mint, owner, wallet, source/report hash,
   idempotency key and expiry; decoding a header alone does not prove those
   private bindings, wallet linkage, readiness or payment finality.
3. Construct an `ExactSvmScheme` with the existing Kit wallet's **sign-only**
   projection. Set its RPC URL to `/api/research/rpc?intentKey=<intentKey>` on the
   authenticated first-party host. This proxy permits only USDC mint metadata
   and a latest blockhash, at most three total preparation reads per intent.
4. In the sign-only callback, before asking the user to sign, POST the unsigned
   wire to `/api/research/prepare` as `{intentKey,transactionBase64}`. Exact
   transfer/memo/fee-payer/instruction checks and simulation must pass.
5. Only after the user approves the displayed $0.10 purchase, create a payload
   and GET its declared resource with `PAYMENT-SIGNATURE` from the SDK.
6. Read the saved receipt. HTTP200 + `PAYMENT-RESPONSE` is emitted only when
   the actual exact transaction is independently found at finalized commitment.
   HTTP202 means protected verification, not completion. Status polling never
   sends another settlement request.

SDK signing shape (inside an already authenticated, explicit purchase handler):

```ts
const signer = {
  address: connected.signer.address,
  modifyAndSignTransactions: async (transactions, options) => {
    await prepareExactlyOnce(transactions[0]); // /api/research/prepare
    return connected.signer.modifyAndSignTransactions(transactions, options);
  },
}; // Deliberately omit every send capability.
const sdk = new x402Client().register(
  declaration.accepts[0].network,
  new ExactSvmScheme(signer, { rpcUrl: authenticatedResearchRpcUrl }),
);
const payload = await sdk.createPaymentPayload(declaration);
const header = encodePaymentSignatureHeader(payload);
// One explicit authenticated GET to declaration.resource.url with that header.
```

## Executable offline owner-client rehearsal

`examples/research-owner-client.mock.ts` and its test are a **mock-only example**
of the existing contract, not a second checkout implementation. Run offline:

```sh
bunx --no-install vitest run examples/research-owner-client.mock.test.ts
```

The example requires an injected in-memory transport, an explicit approval
callback, an inert sign-only callback and a supplied clock. It has no default
`fetch`, RPC, wallet client, facilitator, environment credential or private key.
Only a fixed fake human-owner credential marker is accepted; an evidence-agent
grant is never substituted for an owner session JWT. Its fake wire constants
are not valid unsigned/signed Solana transactions and must never be submitted.
Do not replace the mock seams with live networking or a wallet.

The tests supply each seam directly and demonstrate:

1. Read the catalog, refuse unavailable/exhausted readiness, and request one
   intent with the exact wallet, mint and idempotency key.
2. Decode `PAYMENT-REQUIRED` using the installed `@x402/core` **2.29.0** HTTP
   helpers, then reuse this application's existing pure requirement/resource
   builders and payload validator. A changed amount, asset, network, treasury,
   memo, version or resource is refused before approval.
3. Show the bound review summary and require explicit approval. Inside the
   inert sign-only seam, call `prepare` exactly once with the same intent and
   fake unsigned wire. Refusal, missing/duplicate preparation, changed payload
   or expiry prevents the signature-bearing request.
4. Make at most one resource request containing `PAYMENT-SIGNATURE`. Repeated
   or concurrent `reviewOnce()` calls reuse one promise; they do not obtain a
   new quote, ask again, or replay settlement after an ambiguous response.
5. Treat HTTP202, unknown/rejected outcomes, malformed proof or transport
   failure after that request as **mock-protected**, not paid. Only an explicit
   `checkSavedReceipt()` reads the same resource again, without a payment
   signature header. It never polls or requests settlement automatically.
6. Return the already-supplied frozen report only for a matching mock fulfilled
   receipt and `PAYMENT-RESPONSE`. No report is regenerated or retimed.

This deliberately does **not** construct an `ExactSvmScheme`, build/sign/send a
transaction, call the preparation RPC proxy, test a real session or wallet,
reserve facilitator credits, settle funds, prove report provenance or validate
on-chain finality. The installed `@x402/svm` **2.29.0** production sign-only/v0
path above remains unchanged. `mock-fulfilled` is synthetic protocol evidence,
never a claim that payment occurred. Real acceptance remains a separately
authorized operator/user-controlled test with the existing holds and budgets.

## Durable failure policy

The database atomically claims verification and settlement once. Known invalid
pre-settlement verification is rejected. Ambiguous provider errors, timeout,
missing signature or unproven finality stay protected/unknown. Never retry
settlement, replay a signed wire, release a hold or refund automatically.

An exact known signature may be checked read-only by
`forumResearchActions.check`; absence is not proof of nonpayment. Successful
delivery and previous exports remain owner-readable. If an already-settled
payment cannot deliver its frozen report, support must investigate the original
receipt. There is no promised automatic refund or treasury signing authority.
