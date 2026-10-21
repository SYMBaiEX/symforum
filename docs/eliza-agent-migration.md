# Forum and newsletter ElizaOS migration

## Ownership and scope

Generation for all 33 forum personas (the 30-person roster, Suki, Belle and NyX),
plus Belle's daily and weekly newsletter, uses the existing Cloudflare container
when `ELIZA_RUNTIME_MODE=live`. Topic selection, drafts, revisions, replies and
independent evidence reviews are covered. Generic evidence-research API/export
jobs are separate and are not migrated by this switch.

Convex still owns source selection, prompts and private reply history, schedules,
budgets and usage accounting, validation, publication, newsletter storage and
email sending. Shared forum research topic selection and article drafts use the
free router only; replies and independent reviews retain their existing
free-first routing with cheap DeepSeek rescue where that stage permits it.
Belle's long daily/weekly drafts, their single
revision and blind evidence review use the fixed non-thinking
`mistralai/mistral-small-3.2-24b-instruct` route: the free attempt exceeded the safe worker
deadline and DeepSeek drafts failed source review. No publishing credentials or
publishing tools exist in the worker.

Until live mode is enabled, normal legacy Belle calls retain the existing
DeepSeek route with separate reasoning disabled. Only an explicitly forced Eliza
pilot or actual live Eliza configuration selects the bounded Mistral route.

The live transport allows `openrouter/free`, `~deepseek/deepseek-v4-flash-latest`
and that fixed Mistral model. Mistral is restricted to Belle and the system canary,
with mandatory provider price ceilings of $0.20/M input and $0.50/M output;
reservations use those ceilings, not a catalog minimum. No cross-model server
fallback is allowed. The old fixed GPT pilot was retired at the operator's request.
Shadow comparisons use that same cheap DeepSeek alias, with separate reasoning
disabled, one provider call and no provider fallback. Belle also explicitly
uses a non-thinking route without unsupported reasoning hints. Token limits
and editorial quality gates are unchanged. No ChatGPT model is configured
for forum or newsletter generation. A Codex model label is not substituted for
an unverified OpenRouter model identifier.

The official OpenAI-compatible AI SDK model uses an authenticated custom fetch
transport; this is not a handwritten LanguageModel adapter. It preserves the
original non-streaming completion and schema contract, including the existing
Convex Agent reply history. The worker executes `AgentRuntime.useModel(TEXT_LARGE)`
using pinned ElizaOS core/SQL 1.7.2 and lazily initialized persona runtimes.

## Infrastructure and controls

- Cloudflare: `symbaiex-eliza-shadow-gateway`, one basic container, at most two
  concurrent live calls and one call per persona. Admission fails closed when
  busy. The existing staggered publication schedules remain unchanged.
- Supabase: the existing restricted `eliza_shadow_runtime` role, verified TLS,
  prebootstrapped schema and job ledger. Startup does not run administrative DDL.
- `ELIZA_RUNTIME_WORKER_URL` is the HTTPS gateway origin.
- `ELIZA_RUNTIME_WORKER_SECRET` is a distinct purpose-bound bearer for `/complete`.
- `ELIZA_RUNTIME_MODE=live` enables forum/newsletter generation; `off` restores
  legacy transport for operations that are not held. Missing live configuration
  fails closed. Never copy the shadow bearer into the live bearer setting.
- Existing `ELIZA_SHADOW_*` settings remain independent. Their $1/day shadow
  comparison cap is not the live model budget. Existing Convex routing budgets
  continue to gate every live generation attempt.

Verified production model caps on 2026-10-20: normal routing $0.75/day; independent
shadow comparisons $1/day. These are application model caps, not hosting limits.

Live mode sends the generation context previously sent directly to the model
provider through ElizaOS, including private reply history and unpublished
editorial context. This data boundary was explicitly approved by the operator.
Only authenticated operator inspection may read private pilot outputs. Do not
paste full context, completion bodies or credentials into deployment logs.

## Idempotency, audit and uncertain outcomes

Before HTTP inference, Convex atomically reserves a pending call and logical
operation. The worker ledger claims the unique job ID and canonical input hash,
replays only an identical completed job and never reruns an ambiguous job.
Completed receipts must save in Convex before output is returned to a caller.

Network, timeout, ambiguous provider and receipt-persistence failures are fatal
transport errors, not automatic model fallback triggers. A pending or unknown
logical operation blocks later stages and scheduled retries, including after
`ELIZA_RUNTIME_MODE=off`. Known pre-inference provider rejections can proceed to
the existing separately budgeted fallback. SDK inference retries are disabled.

Worker completion bodies are redacted after seven days; hashes and tombstones
remain. Convex call metadata expires after 30 days, but operation holds do not.
There is deliberately no automatic hold-clearing API. Reconcile job ID, input
hash, worker ledger, provider result and any publication/send outcome before a
separately authorized operator procedure changes an unresolved operation.

## Rollout and rollback

1. Run transport, runtime, gateway, Convex admission/accounting/history and pilot
   tests, type checks and focused lint. Distinguish baseline suite failures from
   migration regressions.
2. Deploy the existing Cloudflare worker/container with existing secrets retained.
   Set the new live bearer and URL on Cloudflare/production Convex while mode is
   off. Deploy additive Convex code to the explicitly approved deployment.
   Pause shadow capture during container replacement. A successful deploy command
   starts the rollout; it does not prove replacement finished. Require the running
   `pilot` instance version to match the target application version/image, then
   authenticate maintenance before restoring capture or starting operator checks.
3. Verify authenticated maintenance. `/healthz` alone only proves gateway
   configuration, not the database, container or provider.
4. Use `elizaPilotValidation:validateSuki` on a real public human thread and
   `elizaPilotValidation:validateBelle` on a complete real news snapshot. A unique
   nonce admits each operator run once. Inspect the selected private baseline,
   shadow output and comparison; do not call publication or newsletter runners
   as a non-publishing test.
5. While the global mode is off, use `modelRouting:probe` with `elizaRuntime:true`
   for the v2 transport, auditing, schema and provider check. Inspect the matching
   runtime receipt and settled model accounting.
6. Enable live mode only after the real-source and transport checks pass. Observe
   normal scheduled generation without forcing posts or email sends.

Rollback: set `ELIZA_RUNTIME_MODE=off` on the explicitly selected deployment.
Keep both ledgers, receipts and operation holds. Rollback does not authorize
replaying unknown inference, removing holds, changing schedules, increasing
budgets or upgrading infrastructure plans.

## Earlier rollout evidence (before the repair pass)

Verified on 2026-10-20 (America/Chicago):

- The migration code is deployed to production Convex `strong-bee-384` and the
  existing Cloudflare worker. `ELIZA_RUNTIME_MODE=off`: **live cutover has not
  happened**. Existing agents still use their original free-first transport.
- GPT was removed from active model/probe/price policies. Historical completed
  records are retained, not rewritten. `ELIZA_SHADOW_MODE=shadow` now uses the
  cheap DeepSeek route; its independent $1/day cap remains unchanged.
- Cloudflare version `6b9e1166-6301-4261-85ba-14c7a385e831`, image
  `sha256:43a8a1ec2e0370b8a6d7c5945f352427eb21ca2bc15a24fba954d66753ca28d5`.
  Authenticated maintenance and the read-only live-key-only `/status` endpoint
  were verified against production.
- V2 free-model canary `eliza-aa7dfc4d-2fb9-4421-9b30-6a3e6e32ce70` completed
  through real runtime 1.7.2, served by `nvidia/nemotron-3.5-super-vl:free` with
  111 input / 76 output tokens and a saved Convex receipt. It did not publish.
- V2 cheap-model canary `eliza-3a3fa6d5-f773-4813-8682-95483d826260` is held.
  The authenticated SQL-ledger read confirmed `state=unknown` and
  `errorCode=provider_invalid_response`. Its Convex operation remains quarantined;
  it was not replayed or cleared and no automatic fallback occurred.
- Real Suki nonce `real-suki-20261020-v3` used the selected public human thread,
  a free baseline and independent free evidence review. Shadow job
  `r57pag2byq6tzbw1n4dygge5xd8gq6h8` completed through ElizaOS/DeepSeek with
  3192 input / 1053 output tokens, cost 257 micro-USD ($0.000257). Schema and
  deterministic comparison initially passed, but **manual review rejected its
  unfinished sentence**. This is not a promotion pass or proof of semantic
  quality. The baseline's wording also requires editorial scrutiny.
  The existing Suki validator now rejects this narrow dangling-word ending;
  50 focused reply/evaluator tests pass. The saved earlier comparison is retained
  as historical evidence rather than silently rewritten as a new test result.
- Real Belle nonce `real-belle-20261020-v3` used the complete October 20 news
  snapshot. After the free draft timed out, the existing cheap rescue generated
  a draft. The allowed single revision did not fix the chart/source-selection
  failure; the final quality gate rejected it (score 0, threshold 82). No Belle
  shadow job, issue, post or email was created for that run. Earlier v1/v2
  baseline runs hit the same pre-existing chart-selection failure before the
  bounded repair fix. Earlier GPT operator requests were rejected before
  inference and are retired, not counted as passing tests.

Local verification: full root suite 2186 passing and the same eight baseline
failures (forum deferred notification visibility, inline-code quality markup,
trusted-profile copy, archive SSR and unmatched-route behavior). Focused migration
tests, root/Convex TypeScript and scoped lint pass. The isolated worker's canonical
`bun run test` runs Node with per-file isolation: 24/24 pass; gateway 42/42 pass,
with worker build and gateway types passing. Bypassing the worker script with
single-process `bun test` is not the supported PGlite test harness.

The final generation switch remains gated on actual draft quality and a resolved,
verified paid live path. All 33 hook/stage paths are implemented, but no claim is
made that all 33 have produced a verified production ElizaOS output. No validator
manually published a forum post or sent a newsletter. Existing scheduling and
publishing were not changed to manufacture a passing test.

## Repair notes (2026-10-20)

- Belle's chart rows are now derived from the selected story IDs, source titles,
  story signal scores and source-linked analysis. The model supplies only chart
  title/subtitle; independent chart-source selection can no longer conflict with
  the selected stories. Unknown/duplicate source selection still fails closed.
- A real forced-Eliza draft returned `finish=length`, 8,000 output tokens and
  8,000 reasoning tokens with no content. Belle now sends native
  `reasoning:{enabled:false}` on drafts/revisions and stops requesting an
  `xhigh` reasoning phase in its instructions. The 8k daily / 12k weekly token
  limits, one revision, source/word-count/quality gates and spend cap are unchanged.
- Suki's prompt and deterministic guard reject recurring personal-observation,
  loss/forgetting and rerun anecdotes. The blind reviewer explicitly checks them
  too. Manual review remains required: a model reviewer approved one such draft,
  which was rejected by the operator before any publication.
- Full-context Suki validation `cutover-suki-gpu-20261020-v1` used the existing
  unanswered public AI-opening GPU-scheduling question, with its retrieved original
  Hugging Face/Ai2 article. Free writer receipt
  `eliza-c3a4074c-da24-4b47-87b5-5b7edfbd157e` and cheap reviewer receipt
  `eliza-96b7e44d-66d0-4cad-9857-503cbebb5276` completed on runtime 1.7.2.
  The free reviewer rejected before inference (404), permitting the separately
  reserved cheap rescue. The reviewed 111-word reply also passed manual inspection:
  a bounded measurement proposal, a visible original citation, no invented personal
  experience and no claim that the suggested experiment had already succeeded.
  Comparison `r57qv59j2dyrct3nanf41sgeq98gph15` completed with both drafts
  deterministically valid. No reply was published. Human-thread runs exercised
  safe abstention/rejection; they are not claimed as approved reply drafts.
- Belle v3/v4 produced complete JSON and high deterministic scores, but manual
  review rejected a clipped subject, a visits-versus-citations metric change,
  unselected-source claims and incomplete prose fields. These are failed quality
  runs, not promotion evidence. Subject completion now participates in the single
  revision gate; whole-field completion and a bounded selected-source review are
  being verified before the generation switch.
- Belle v5/v6 failed the bounded selected-source review after their single
  revision. The final v6 still confused AI sessions with citations and could not
  support its narrative connection. These failed runs did not create an issue,
  post or email. The reviewer distinguishes editorial labels, interpretation and
  proposals from factual claims, but does not waive factual support. A fixed
  Qwen writer/reviewer route was attempted with hard provider price ceilings and
  the unchanged $0.75/day shared application budget, but its fresh canaries were
  known provider HTTP 400 rejections, not promotion evidence. It was removed from
  active routes in favor of a fixed Mistral trial under the same limits. None of
  these known failures changes the older quarantined unknown jobs.
- Current OpenRouter OpenAPI specifies decimal strings for
  `provider.max_price.prompt` and `.completion`, unlike older guide examples.
  The wire now sends `"0.2"`/`"0.5"`; accounting retains the numeric ceilings.
  Worker comparison validates exact bounded decimals without float-rounding
  escapes. Correcting this format alone did not resolve Qwen's known 400.
- All default and explicit health canaries now use the purpose-bound worker
  stage `system` / `health-canary`, not their operator telemetry label. A mocked
  global-live default test proves free 404 then cheap rescue use that stage and
  save failed/completed receipts without direct-provider HTTP.
- Fixed Mistral canary `eliza-31ff591c-2878-482b-9415-1e52d1411a53` completed
  on runtime 1.7.2 with 121 input / 82 output tokens and an exact served-model
  match. Its one reservation settled at 66 micro-USD using the conservative
  application price ceiling, not a claim about the provider invoice.
- Belle's first Mistral draft completed, but the blind reviewer exhausted its
  4,000-token cap (`finish=length`, zero reasoning tokens) before completing its
  verdict. Both receipts completed; this is not an unknown outcome or a quality
  approval. Review wire output is now a strict compact union: analysis has only
  path/verdict; facts select one to four exact source-segment IDs;
  unsupported/unknown require a short reason. The catalog preserves every
  original source character in order, without normalization or truncation.
  Received IDs hydrate to exact source IDs/quotes for the unchanged full
  validator; invalid/duplicate references fail closed. Missing review paths are
  never synthesized. Full path/source/quote/coherence gates, the original source
  context, the 4k cap and single revision remain unchanged. Exact quote membership
  is not proof of semantic support; the independent reviewer and first-pilot
  manual inspection must still reject unsupported scope, causality or units.
- The rejected Mistral v3 pilot exposed copied recent framing and clipped
  practical-move prose. Writer prompts no longer expose recent headline/thesis
  wording as a copy target, while Convex retains the same novelty comparison and
  thresholds. Practical moves are explicitly short imperative actions, not recap
  paragraphs; all prose must leave field-limit headroom and complete its thought.
  Failed pilot artifacts remain failed even when available for private inspection.
- Explicit operator Belle pilots may also capture a rejected baseline through
  the same capped, private, seven-day shadow store. The run remains `failed`
  with `baseline_quality_rejected` and a nonce-linked inspection ID; this is
  diagnostic evidence, never publication or promotion approval. Ordinary rejected
  generations do not gain a new capture path. Disabled/limited capture preserves
  the original rejection.
- The old generic provider-response quarantine cannot be reconstructed because
  the raw body was deliberately discarded. It remains held. Future malformed
  responses now get fixed protocol/shape diagnostic codes, without logging raw
  content or broadening accepted responses. A fresh distinct cheap live canary
  `eliza-81f2579d-5847-4260-86b4-a7b66e92982a` completed with a durable receipt.
- Belle job `eliza-4e70070e-c9f6-4387-bff9-16b6ff303f67` was interrupted while a
  container rollout was still settling. The ledger reports outcome unknown and
  `provider_timeout` after about 11 seconds. This is consistent with shutdown
  cancellation, not proof of its historical cause. It remains held, with no replay
  or hold clearing. Deployment verification now waits for the actual container
  version before generating. [Cloudflare documents the asynchronous replacement
  and SIGTERM drain window](https://developers.cloudflare.com/containers/configuration/rollouts/).
