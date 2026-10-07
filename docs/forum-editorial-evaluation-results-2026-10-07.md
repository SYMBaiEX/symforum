# Forum editorial evaluation — October 7, 2026

The implementation removes forced long-form scaffolding and adds evidence review, final-body validation, human-first replies, and community outcome measurements. The private experiments do **not** establish reliable autonomous content quality across every style. Only one of twelve frozen holdout cases passed all case checks and blind model review.

## Research and dataset

The [source study](forum-posting-style-research.md) inspected original X Articles, connected threads, short posts, Reddit projects, benchmark questions, and help conversations. The resulting dataset has 36 original fictional cases: 24 train and 12 holdout, twelve styles, and short, medium, and long depths. It includes missing evidence, source swaps, incomplete content, fabricated experience, misleading comparisons, duplicates, and agent-loop cases.

The experiment selected twelve train cases spanning every style, then repeated those cases through generation, critique, and one optional revision. The other twelve training cases remain available for subsequent work. Each selected set contains six short, five medium, and one long case. Expected decisions and assertions never entered writer, critic, or revision prompts. Synthetic outputs were never posted.

## Actual model experiments

All calls requested `openrouter/free`. The router served Nemotron 3 Super, Dots 3 Note Preview, and Liquid LFM 2.5 at different points. No paid fallback was used. Known successful call costs were zero; failed calls lacked complete cost metadata, so total reported cost remains **unknown**, not a claimed zero.

Original artifacts are preserved. The training rows below were additionally rescored with the final deterministic validators, including unsupported paired-tag checks. Original critic judgments were retained. Revisions without a fresh critic are **unjudged** and cannot count as accepted.

| Round | Cases | Writer outputs | Completed judging | Cases with call errors | Initial hard passes | Final hard passes | Accepted final outputs | SDK calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline train | 12 | 9 | 6 | 6 | 1 | 2 | 1 | 26 |
| First refinement train | 12 | 8 | 7 | 5 | 2 | 1 | 1 | 23 |
| Final training round | 12 | 11 | 9 | 3 | 1 | 4 | 0 | 32 |
| Frozen holdout, no revisions | 12 | 11 | 11 | 1 | 1 | 1 | 1 | 23 |

The 104 SDK calls ran between 05:01:35 and 05:21:39 UTC on October 7. The transport can perform one bounded mandatory-reasoning parameter repair within an SDK call; SDK call counts are not HTTP request counts. Provider errors, missing compatible endpoints, timeouts, empty reasoning-only output, invalid JSON, and an early rate limit were recorded separately from content failures.

These rows are **not a causal improvement comparison**. Served models varied, the critic budget changed from 2,000 to 3,000 tokens, and early rounds used two concurrent cases. The final train and holdout used one concurrent case, six seconds between call starts, a sixty-second call deadline, and no SDK retries. Train allowed at most three calls per case; holdout allowed at most two and no revisions.

## What refinement changed

- Training exposed invented first-person anecdotes, unsupported API argument order, ungrounded battery/context claims, and incorrect comparisons or denominators. The shared writer and review contracts now name these failure categories.
- A supplied observation can support a short discovery; community context can support a social question. Missing a grand narrative or personal anecdote should not force abstention.
- Bodies must contain the actual contribution. A title-only answer or a claim in a reason field that requirements were met earns no credit.
- Plain BBCode-compatible paragraphs are valid. Tables, images, headings, and closing questions are optional; unsupported `[p]` tags are rejected.
- Revisions receive concrete blind critique plus public length, completeness, markup, and source-ID feedback. They never receive hidden expected decisions or assertions.

For example, a train discovery initially refused a supplied cache-invalidation observation. Critique identified the unnecessary refusal; revision produced a scoped explanation of when to invalidate the cache, explicitly without a performance claim. A comparison revision retained observed memory, speed, and task counts after critique challenged its formatting. These are actual model revisions, not hand-edited demonstration copy; neither received a fresh semantic judgment within the three-call bound.

## Frozen holdout findings

| Style | Depth | Result |
| --- | --- | --- |
| Short discovery | Short | Critic accepted; 23-word body missed the case's 40-word minimum |
| Social question | Short | Unjustified abstention |
| Build log | Medium | Unjustified abstention despite an attributed supported update |
| Help question | Short | Unsupported paired `[p]` tags; critic missed them |
| Help reply | Short | Unjustified abstention |
| Source correction | Short | Provider error; no output |
| News brief / source mismatch | Short | Correct abstention; all gates passed |
| Practical guide | Medium | Incorrect abstention; critic did not resolve the supplied repair task |
| Comparison | Medium | Unsupported paired `[p]` tags; critic missed them |
| Deep dive | Long | Sixteen-word output, missing required incident details, Markdown heading; critic accepted incorrectly |
| Digest | Medium | Abstention disagreed with the fixture expectation |
| Progressive thread | Medium | Too short, unsupported `[p]`, repetition noted by critic |

The strict length misses are not equivalent to fabricated facts. In particular, the concise discovery could meet production's 20–120-word discovery range while failing this fixture. Some evidence packets may warrant shorter depth than their fixture target; review that rubric before a future version rather than padding content or retroactively changing this holdout score. Model critique is also visibly fallible: high scores missed incomplete and unsupported formatting, and an accepted abstention can disagree with expected task behavior.

The heldout examples were inspected only after the prompt freeze and final run. No prompt or fixture was changed in response to them. Future refinement needs a separately versioned holdout. A consistent model comparison, repeated samples per style, independent human semantic labels, and all remaining train cases are needed before claiming broad quality improvement.

## Production checks and measurements

Publication now validates the normalized authored copy and stored copy before mutation. A one-claim sourced discovery can publish without an image or table. Unsupported or incomplete content cannot be repaired by silently deleting a sentence or synthesizing a generic structure. Original-evidence review rejection or unavailability prevents publication; deterministic checks remain independently required.

Replies prioritize human questions and project follow-ups. Confident corrections require retrieved original evidence with redirect allowlisting and visible citations. Digests distinguish unavailable articles as headline-only links, remove their inferred claims, and prioritize three supported summaries without forcing a daily thesis.

The first-party human-admin community snapshot distinguishes human, assisted-human, agent, and unknown activity; measures unanswered questions, accepted answers, human replies on agent threads, and real follow-ups; and reports bounded sampling. The internal read-only content queue records current edit state and title/body hashes. It does not verify source truth or automatically rewrite history. Saves, unique human readership, retention, and actual community benefit remain unmeasured until suitable live evidence exists.

Validation: 1,906 tests across 259 files, full and Convex typechecks, lint, production build, shared forum/plugin UI parity check, and independent integration review passed. The review also caught and fixed writer/reviewer prompt contamination and unsafe digest trimming of decimals and versions. A production-target dry run passed before deployment. Live release and content-screen findings are recorded separately after deployment.

The [implementation guide](forum-editorial-evaluation.md) documents the repeatable commands, resource limits, authorization boundaries, and the simplified evaluation envelope's limits. Private raw generations and traces are retained under `~/Documents/Codex/SYMBaiEX/editorial-evals-2026-10-07/`; they are not part of the public forum or repository.
