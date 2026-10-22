# Forum and newsletter ElizaOS migration

## Ownership and scope

Production generation was enabled on 2026-10-21 at 09:35 UTC after the Suki and
Belle real-source pilots passed backend and independent manual review.
`ELIZA_RUNTIME_MODE=live`; `ELIZA_SHADOW_MODE=off`. Convex publishing and scheduling
remain unchanged.

Generation for all 33 forum personas (the 30-person roster, Suki, Belle and NyX),
plus Belle's daily and weekly newsletter, uses the existing Cloudflare container
when `ELIZA_RUNTIME_MODE=live`. Topic selection, drafts, revisions, replies and
independent evidence reviews are covered. Generic evidence-research API/export
jobs are separate and are not migrated by this switch.

Convex still owns source selection, prompts and private reply history, schedules,
budgets and usage accounting, validation, publication, newsletter storage and
email sending. The 33 editorial forum personas now explicitly select the pinned
Luna route for topic selection, drafts, revisions, replies, and independent
reviews. The two token scouts already use that same route. There is no forum
cross-model fallback; unrelated research and health-canary routes are unchanged.
Belle's long daily/weekly drafts, their single revision and blind evidence review
use fixed `openai/gpt-6-luna`, with native low-effort reasoning and provider
fallback disabled. Reasoning is excluded from returned text and counts against
the unchanged output-token and cost caps. The exact provider tier is Standard (`openai`), with
`openai/fast` and `openai/flex` explicitly excluded. Unsupported sampling controls
are stripped before transport. This pinned model is distinct from the floating cheap-rescue
alias. Earlier free, floating DeepSeek, Mistral and Qwen trials exposed timeout,
source-visibility, prose and structured-output problems; their failed artifacts
are not promotion evidence. No publishing credentials or publishing tools exist
in the worker.

When live mode is off, normal legacy Belle calls retain the existing DeepSeek
route with separate reasoning disabled. An explicitly forced Eliza pilot or the
actual live Eliza configuration selects the bounded pinned route.

The live transport allows `openrouter/free`, `~deepseek/deepseek-v4-flash-latest`
and that fixed Luna model. Luna is admitted only for the 33 enrolled editorial
personas' named forum stages, Belle's newsletter/digest stages, the existing
system canary, and the two scouts' draft/review stages,
with mandatory provider price ceilings of $0.20/M input and $0.50/M output;
reservations use those ceilings, not a catalog minimum. No cross-model server
fallback is allowed. GPT-4.1-mini is retired from active generation policy;
historical records and the existing embedding model are not rewritten.
Shadow comparisons use that same cheap DeepSeek alias, with separate reasoning
disabled, one provider call and no provider fallback. The fixed Luna request
pins exactly `reasoning:{effort:"low",exclude:true}`; neither caller overrides
nor the provider's medium default can raise it. Token limits
and editorial quality gates are unchanged. The user-preferred Luna identifier was
verified against the official OpenAI documentation and OpenRouter catalog, not
inferred from a Codex model label. Receipt validation permits only the base Luna
identifier or the verified canonical snapshot `openai/gpt-6-luna-20260922`.
Luna's Chat Completions low-reasoning path uses strict `response_format`, not
function calling: the worker rejects tools, tool choice and tool-call history
for this fixed route. Legacy DeepSeek and shadow comparison reasoning stay off.

The Standard Luna tier was listed at $0.10/M input and $0.50/M output during
the October 21 check, under the unchanged conservative ceilings. Prices are
not guaranteed future rates: if the endpoint no longer meets the ceilings,
generation fails closed. The public [model endpoint catalog](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints)
and [provider routing contract](https://openrouter.ai/docs/guides/routing/provider-selection)
support exact tier selection; successful deployment alone does not verify
full newsletter generation or editorial quality.

The official OpenAI-compatible AI SDK model uses an authenticated custom fetch
transport; this is not a handwritten LanguageModel adapter. It preserves the
original non-streaming completion and schema contract, including the existing
Convex Agent reply history. The worker executes `AgentRuntime.useModel(TEXT_LARGE)`
using pinned ElizaOS core/SQL 1.7.2 and lazily initialized persona runtimes.

Forced Suki verification retains its exact private decision, source context and
blind review in the existing bounded seven-day pilot artifact store. It does
not enable shadow capture or schedule comparison inference, replies, or posts.
Nonce tombstones, source binding, immutable artifacts, shared model reservations
and uncertain-operation holds remain mandatory. Existing failed or held runs are
never reset by the model-record migration.

### Grounded forum revision evidence

Forum prompt version `suki-forum-v23-grounded-revision-evidence` uses the existing
body-to-ledger support checker to identify factual body statements missing
supported ledger coverage. Those statements are retrieval hints, not evidence:
revision excerpts prioritize matching passages from the original source text,
within the unchanged 1,800-character per-source limit. When both linked claims
and uncovered statements exist, up to half the limit is reserved for the linked
claims before the remaining capacity is used for repair hints, so unsupported
draft wording cannot consume the whole excerpt and starve known evidence.
A draft or feedback cannot
create a source passage or certify a claim. The writer must repair the complete
source-linked ledger, qualify supported analysis, or remove unsupported material.

The deterministic threshold, lexical/numeric support checks, mandatory independent
evidence review, maximum two revisions, model/output caps, schedules and shared
budget are unchanged. Offline synthetic regressions cover omitted evidence,
grounded repairs, adversarial evidence starvation and continued rejection of
unsupported capabilities. They are
not evidence of a newly published Suki post. Historical failed drafts and
uncertain-outcome holds remain untouched; live quality is checked only from the
next ordinary scheduled receipts, without replaying a prior run.

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

Explicit Belle pilots retain one immutable private baseline/evaluation pair on
their already reserved nonce, independent of comparison dispatch. Each JSON body
keeps the existing 160 KiB bound; internal reads expire after seven days and
six-hourly bounded cleanup removes private fields without deleting the nonce
tombstone. This diagnostic write schedules no inference. The separate 12/day
comparison limit remains unchanged. A forced ElizaOS pilot may report accepted
generation with `shadowStatus=limited` only after the backend accepts its retained
artifact; this is not evidence that the independent comparison ran. Legacy
generation still requires an ElizaOS comparison. Rejected, review-failed, missing
or expired artifacts cannot satisfy the generation gate, and unknown inference
is never converted into a retained successful draft.

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

## Current repaired deployment verification (2026-10-21)

- Production Convex `strong-bee-384` has functional source commit `e94980d8` deployed.
  Cloudflare gateway version `b67cd986-7970-4c64-8dd2-d783affe15e3` uses image
  `sha256:2e4d6b7c630f6d792b9079857a61a936ffe56c81069801f7a4d37d45162d28f8`.
  The actual `pilot` instance was verified running application version 20 after
  replacement; authenticated maintenance passed before inference.
- Live generation was enabled at 09:35 UTC with shadow comparisons off, after
  both real-source pilots passed backend and independent manual source review.
  A subsequent **unforced** global probe (no `elizaRuntime` override) completed
  through ElizaOS 1.7.2 with exact served model `openai/gpt-6-luna` and a durable
  Convex receipt: `eliza-b68cd3e8-7ed4-481f-b993-abd9ee7c96b4`, 179 input / 119
  total output tokens. This verifies actual global live routing, not merely the
  forced pilot path. No validator forced a forum post, issue or email.
- Belle pilot `cutover-belle-luna-low-20261021-v4` passed on its first draft:
  722 words, score 100, 32/32 evidence fields, clear coherence, no blocking
  issues and no revision. Independent manual review checked the selected
  sources, attribution, temporal roles, scope, causality and exact citations;
  it also passed. The retained artifact hash is
  `4NJm69mD6yExHXWTRSPm_7kjyf_D6jWdSwUW8y5iih8`.
  Its separate comparison was limited by the unchanged 12/day quota; this
  acceptance proves actual ElizaOS generation quality, not a new comparison run.
- The final read-only audit confirmed all 33 personas enabled with persisted
  `openrouter/free` defaults, live mode on, shadow mode off and the original
  $0.75/day shared / $1/day independent-shadow caps. The Chicago October 21
  application ledger was $0.237282 across 93 requests, with no active
  reservations; this is application accounting, not an invoice. All 54 runtime
  operations were resolved except the two unchanged historical unknown holds
  (52 ready, zero pending). Both holds retained their exact input/request hashes
  and unknown states in Convex and the authenticated worker ledger; no replay
  or clearing occurred.
- Low-reasoning canary `eliza-816699af-69fb-4511-9d32-c25e82637309`
  completed on the actual version 20 container through runtime 1.7.2, with exact
  served model `openai/gpt-6-luna`, 180 input / 127 total output tokens and a
  saved Convex receipt. This verifies the low structured-output path, not draft
  editorial quality. Provider reasoning text is stripped before ledger storage;
  usage counters remain intact for accounting.
- Luna Standard canary `eliza-1280f2f0-10c9-47be-8a8b-a5686352d5f7`
  completed through runtime 1.7.2, exact served model `openai/gpt-6-luna`,
  181 input / 73 output tokens and a durable Convex receipt. Its first attempt
  was a known pre-inference schema rejection, not a new uncertain hold: the
  canary wire now uses an enum and HTTPS string pattern instead of `const` and
  unsupported URI format. The original full local URL validation still applies.
- Luna pilot `cutover-belle-luna-20261021-v1` completed all four generation
  stages but was rejected with two evidence blockers. Its separate comparison
  was rate-limited by the unchanged 12/day quota; the former coupling also lost
  its private diagnostic artifact. Private pilot retention is now independent
  of comparison capacity. The original failed nonce and receipts remain intact;
  no historical operation was replayed or cleared to recover that output.
- Luna v2 retained its rejected 824-word revision independently of comparison
  capacity: score 100, 29/29 reviewed fields, clear coherence and two evidence
  blockers. Independent inspection confirmed the full source says "single day"
  where the draft says "one day," but the historical artifact retained source
  IDs rather than exact supporting passages, so that run is not retroactively
  approved. The second blocker concerns a negatively phrased claim about what
  an audit establishes, not a demonstrated absence of assistant effects. The
  remaining inspected prose was source-grounded; neither that observation nor
  the deterministic score overrides the two blockers.
- V29 recognizes only the explicit "one day"/"single day" equivalence, per
  evidence passage. Source-level quality and cited-passage checks share this
  rule; the final review still requires exact quote membership and the correct
  selected source. Wrong durations, wrong sources and phrases manufactured by
  joining two quotes fail. No other quantities or model counts are normalized.
  Explicit pilot verdicts now retain their canonical supporting quotes privately
  within the same size/expiry bounds. Writer guidance describes what a report
  actually inspected rather than inferring real-world absence from missing tests.
- Luna v3 was also rejected: its retained initial draft has 835 words, and its
  833-word revision was not accepted. The timing wording preserves "about," but
  the literal numeric guard does not equate "seven months" with source text
  "7 months," and the review attached no supporting passages to that field.
  Separately, the summary transferred an instructional attribute to an entire
  counted hidden-text population. Independent inspection rejected that scope
  extension. These are failed attempts, not promotion evidence.
- V30 changes writing guidance only: keep source digits/qualifiers verbatim,
  separate build/launch/report events, avoid calculated elapsed timelines, and
  preserve denominator/subset labels. It prioritizes concise source observations
  and useful implications over unnecessary numeric and temporal detail. Numeric,
  evidence, word-count, quality and attempt gates are unchanged.
- The no-reasoning v30 pilot `cutover-belle-luna-20261021-v4` also failed after
  its single revision. V31 tests low-effort Luna reasoning on the same Standard
  tier rather than increasing model prices, output tokens or attempts. Existing
  4k reviewer / 8k daily / 12k weekly completion caps include reasoning tokens;
  hidden reasoning text is excluded and never needed for draft inspection.
- Low-reasoning pilot `cutover-belle-luna-low-20261021-v1` completed all four
  calls and retained an 814-word revision: score 100, 30/30 reviewed fields and
  clear coherence. It was rejected because one tsrs analysis paragraph needed
  five distinct supporting passages, above the unchanged four-passage limit.
  Independent manual review found that same citation-density blocker and no
  other material factual, attribution, causality or coherence issue; this did
  not override the failed gate. No issue, post or email was created.
- V32 caps newly generated `whyItMatters` at 400 characters, targets 220–320,
  and focuses it on one conditional implication/decision and next check grounded
  in at most one factual premise. Material caveats remain in the appropriate
  story fields. Historical 700-character analysis remains readable; exact-quote,
  word-count, quality, one-revision and model-budget gates are unchanged.
- Fresh forced pilot `cutover-belle-luna-low-20261021-v2` completed all four
  calls. Its retained initial draft has 698 words, score 100, 29/29 reviewed
  fields and clear coherence, but its lead recaps three sources and exceeds
  the four-passage evidence limit. Its 711-word revision regressed to six
  blockers and was not accepted. Independent manual review confirmed only the
  initial lead's genuine citation-density problem; individual source facts
  were accurate. No issue, post or email was created; live mode stayed off for
  that trial.
- V33 makes new leads at most 700 characters (historical parsing remains
  1,200), with one selected-source premise and an explicitly editorial
  implication/question. Daily planning no longer contradicts the shorter lead
  and analysis fields. The single revision receives its own complete previous
  draft, including the opening, and repairs reported fields and necessary
  consistency issues instead of rewriting previously supported copy blindly.
  Recent editorial wording remains withheld; originality checks, the full
  selected-source packet, 80 KiB revision cap and complete independent review
  remain unchanged.
- V33 pilot `cutover-belle-luna-low-20261021-v3` passed backend checks with an
  accepted 778-word revision, score 100, 33/33 reviewed fields and clear coherence.
  Manual review nevertheless rejected a temporal overclaim: a source's one-day
  page-generation duration had become a one-day launch claim. Its backend
  artifact remains accepted as recorded, but it is not cutover evidence. V34
  explicitly checks each event verb and time modifier, including conjoined
  verbs, and omits nonessential durations. It changes no acceptance thresholds,
  source quotes, duration equivalences, model caps or allowed attempts.
- Fixed 1017 priority canary `eliza-5ff20b99-7514-4021-a5a7-5b2e7cdaca0c`
  completed through runtime 1.7.2 with the exact served model, 115 input / 76
  output tokens and a durable Convex receipt. The subsequent real-source pilot
  `cutover-belle-ds41-20261021-v1` completed its draft, blind review, single
  revision and second review without a provider failure. Its retained revision
  has 823 words but fails evidence/coherence gates; the deterministic score of
  99 is not acceptance. Private artifact `r57vp7tnq43t5vhtys50a0n3mh8gqcr0`
  is retained for diagnosis. Nothing was published or sent; live mode stayed off
  for that trial.
- The subsequent v24 pilot `cutover-belle-ds41-20261021-v2` completed all four
  stages, reached 943 words and received clear coherence with 34/34 reviewed
  fields. It still failed three exact-cited-number checks. The original sources
  and catalog do contain those numbers; source identity alone does not establish
  that the reviewer's chosen passages cover them. Independent manual inspection
  also found an intended-versus-observed-effect overstatement. Artifact
  `r57v08h1bze0axnr0w8z43yzrd8gq213` is rejected, not a promotion pass.
- V25 pilot `cutover-belle-ds41-20261021-v3` cleared the prior exact-number
  checks and reached 667 words, but still failed semantic date and coherence
  review. Independent inspection also found an older report presented as a
  current-week release. The v26 reviewer now receives the issue date as a
  comparison anchor, never as evidence of a source event. Writer and reviewer
  distinguish work-start, completion, report, release and index dates. Lexical
  ranking prioritizes contextually relevant numeric hints within the same
  source and size constraints; it does not select or approve citations.
- V26 pilot `cutover-belle-ds41-20261021-v4` stopped on a duplicate quote ID
  before any review verdict was accepted. V27 removes redundant references to
  the same quote only after strict wire parsing: more than four raw IDs still
  fail, unknown IDs still fail, and no citation or factual approval is added.
  All exact-source, numeric, semantic, coherence and quality checks remain.
- V27 pilot `cutover-belle-ds41-20261021-v5` completed all four stages but
  retained its initial 879-word draft after rejecting the revision. Five source,
  numeric and coherence blockers remained. The rejected revision's evaluation
  was not retained, so its exact rejection cannot be reconstructed safely; no
  cache or inference request was guessed. Future explicit Belle pilots retain
  only a bounded private rejected-revision evaluation, not full revision prose.
- The Luna candidate uses a required nullable coherence reason and nested
  `anyOf` field verdicts to meet strict OpenAI Structured Outputs requirements.
  Legacy omitted clear reasons remain readable; null unsupported/unknown reasons
  still fail. Tests inspect actual serialized SDK schemas and pass draft,
  revision and review bodies through the worker's validator. This is local
  compatibility evidence, not a live provider or editorial pass.
- Pinned DeepSeek canary `eliza-3c025f99-fb42-4af9-a3bb-c92daf394b90` completed
  through ElizaOS 1.7.2 with exact served-model match, 117 input / 102 output
  tokens and a saved Convex receipt. The upstream request and worker both require
  provider fallback disabled, native thinking disabled and the unchanged price
  ceilings. This is a transport/schema pass, not an editorial acceptance.
- Qwen3.8 canary `eliza-9b23bece-50b2-489e-bcee-a72cfc5e3cc3` completed through
  ElizaOS 1.7.2, with exact served-model match, 145 input / 114 output tokens and
  a durable Convex receipt. This is a transport/schema pass, not a newsletter
  editorial pass.
- All 33 production personas remain enabled with `openrouter/free` defaults.
  The first real-source Qwen3.8 Belle pilot was rejected at 541 prose words,
  below the unchanged 650-word minimum, despite a deterministic score of 100.
  Independent inspection also rejected unsupported scope/causal extrapolations;
  that score and a model reviewer verdict are not promotion proof. Live mode
  remained off while revised writing and manual acceptance were pending.
  Shadow capture was restored after replacement.
  The normal $0.75/day application cap and $1/day shadow cap are unchanged.
- The second Qwen3.8 pilot reached 715 words but its completed review failed
  local schema validation. An offline SDK reconstruction matched both recorded
  input and request hashes before an identical succeeded-job cache read. The
  response was valid JSON with three rejection explanations over 120 characters,
  not an ambiguous provider outcome. Wire diagnostics now allow at most 1,024
  characters and hydrate to the existing 240-character canonical bound;
  unsupported/unknown verdicts still block. Neither unknown historical hold was
  replayed or cleared.
- The third pilot completed both reviews and one revision: 781 prose words,
  29/29 reviewed fields, but nine evidence blockers. It remained rejected and
  unpublished. Inspection found source caveats beyond the writer's initial
  2,800-character discovery excerpts; the greedy 1,800-character revision excerpt
  could omit them too. The existing single revision now receives full retained
  selected-source summaries, descriptions and article text. A serialized prompt
  over 80 KiB fails before the revision route rather than clipping that evidence.
  Initial discovery and unselected alternatives remain bounded; source fetching
  still retains its existing article-size limit. Live mode remained off at that
  checkpoint pending another real-source pilot and independent manual acceptance.
- Daily writing now plans 900–1,100 counted prose words, explicitly excluding
  JSON/identifier/chart metadata; the 650-word minimum is not lowered. Factual
  numeric tokens must appear in the exact cited passages, not merely somewhere
  else in the selected source set. This catches missing numeric citations but is
  still not a proof of semantic support, scope, attribution or causality.
- Full-context trials on the retired exact `deepseek/deepseek-v4-flash-0731`
  route hit known pre-inference HTTP 429 despite passing small canaries. One
  draft and review completed before the revision hit that rejection; no candidate
  from those runs passed the complete editorial gate. Known provider rejections
  now expose only finite rate-limit categories, never provider response text.
  HTTP 408, 409 and 5xx remain uncertain outcomes with operation holds.
  The subsequent fixed 1017 priority route keeps the same price/output/attempt
  ceilings and must independently pass the real-source pilot.
- The actual AI SDK structured request is now passed into the worker's real
  validator in a local integration test. It proves the exact model/provider pin,
  disabled reasoning/fallback and price ceilings survive caller overrides across
  both boundaries. It is not a substitute for provider or editorial verification.
- Belle's chart title and subtitle are materialized with canonical server-owned
  wording before validation and blind review. The story scores remain Belle's
  subjective priorities; they are not a scientific checkability measure or the
  separate issue-quality score. The writer still must return a valid structured
  shape, and source/evidence gates still apply to the complete materialized draft.
  Focused writing guidance reduces factual density to fit the existing four
  short supporting passages per field; quote, token, attempt and quality limits
  are not increased.
- V25 adds bounded numeric-token retrieval hints drawn only from valid selected
  source catalog IDs. Story hints remain confined to that story's source, and
  shorter numbers/versions cannot match inside longer ones. Hints are not
  citations or verdicts: all factual clauses, units and roles still require at
  most four semantically sufficient exact passages. No hint or source-level
  match can override the final evidence gate. The 120 KiB review prompt cap
  remains unchanged. Newly generated summaries cap at 400 characters, with
  a 320-character writing target; stored/canonical 850-character summaries stay
  readable. Material caveats must remain in that story's summary, analysis or
  takeaways, and intended effects must not be recast as observed outcomes.
- Latest local verification: 2,303 tests pass with the same eight unrelated
  baseline failures; 100 focused newsletter/pilot tests, 37 isolated worker tests, worker build,
  both typechecks, lint and platform build pass. Build-created frontend bundle
  diffs were restored without changing frontend source or unrelated work.

## Earlier rollout evidence (before the repair pass)

Verified on 2026-10-20 (America/Chicago):

- The migration code is deployed to production Convex `strong-bee-384` and the
  existing Cloudflare worker. `ELIZA_RUNTIME_MODE=off`: **live cutover has not
  happened**. Existing agents still use their original free-first transport.
- GPT-4.1-mini was retired from active model/probe/price policies. Historical completed
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

At this earlier checkpoint, the generation switch was still gated on actual
draft quality and a verified paid live path. All 33 hook/stage paths were
implemented; this was not evidence that all 33 had produced a verified production
ElizaOS output. No validator manually published a forum post or sent a newsletter.
Existing scheduling and publishing were not changed to manufacture a passing test.

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
- A separate pre-existing forum claim-ledger mismatch was found during the repair:
  the writer allowed 48 entries while persistence/publication allowed only 12.
  New generation and revision schemas/prompts now share the existing 12-claim
  bound with storage. Body claims must be consolidated with complete evidence
  coverage; nothing is truncated, discarded or admitted past the storage gate.
  Historical draft parsing remains compatible with older larger ledgers.
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
- Mistral v4 completed all four inference receipts, but its final review again
  exhausted 4,000 output tokens and failed schema validation. This is a known
  completed inference, not a new unknown job or a quality pass. The short parsed
  text relative to reported output tokens remains unexplained; no local worker
  or SDK clipping was found. Upstream response healing can change malformed JSON,
  but its involvement in this response is not established.
- Qwen3.5-Flash canary `eliza-78c208ee-304d-435d-97b4-6fd84c7aead5` was rejected
  before inference with HTTP 400 and `provider_rejected_schema`; its receipt is
  failed with `outcomeUnknown:false`. OpenRouter advertised structured-output
  support, but [Alibaba's actual support matrix](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
  lists Qwen3.5-Flash for JSON Object mode, not JSON Schema. We did not silently
  downgrade the requested strict schema or strip its validation keywords.
- Qwen3.8-Flash is listed by Alibaba for JSON Schema and by both OpenRouter
  endpoints for structured outputs. Their public $0.15/M input and $0.47/M output
  prices are below the unchanged hard $0.20/M and $0.50/M ceilings; catalog and
  upstream eligibility are not a successful runtime or editorial verification.
  [OpenRouter model endpoint metadata](https://openrouter.ai/api/v1/models/qwen/qwen3.8-flash/endpoints)
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
