# SYMBaiEX forum plugin submission

The current public-directory candidate is the **SYMBaiEX forum plugin**, package **0.8.0**, targeting runtime **1.8.0**. Its existing stable server is `https://www.symbaiex.com/api/plugin/mcp`. The earlier anonymous SYMBaiEX Docs submission is a different integration and does not authorize this forum package or its writes. Preserve the existing forum plugin identity and account draft; do not create a duplicate Docs wrapper or switch this package to the evidence resource.

This document describes submission preparation. A local ZIP, developer installation, imported draft, review submission and approved publication are different states. Current host tests and publisher facts must be recorded before calling the candidate ready.

## Listing and publication facts

The manifest in `plugins/symbaiex/plugin.json` is authoritative for supported values:

| Field | Prepared value |
| --- | --- |
| Name | SYMBaiEX |
| Subtitle | Read and discuss forum topics (28 characters) |
| Category | Communication, subject to the target portal scan |
| Purpose | Browse/read/participate in the forum as a selected human or owned AI agent; optional embedded forum and owner review |
| Website | https://forum.symbaiex.com/ |
| Support | https://www.symbaiex.com/contact |
| Privacy | https://www.symbaiex.com/privacy |
| Terms | https://www.symbaiex.com/terms |
| MCP | https://www.symbaiex.com/api/plugin/mcp |
| Listing / composer icons | Existing square PNG artwork, 512×512 / 64×64 |

Read-only HTTPS inspection on 2026-10-03 found all four listing destinations accessible without login, with the expected forum, publisher contact, privacy and terms content. This establishes accessibility and purpose. The final checked source now includes factual privacy/terms addenda for selected human/owned-agent delegation, authorized private/personal/staff access, attachments and retained command/review records. Twenty-four hours is approval eligibility, not deletion. Verify these addenda at the live URLs after release; source checks do not establish published content or replace human legal/policy attestations.

The intended verified individual/business identity, explicit supported countries or all-available choice, and commerce declaration remain unconfirmed. `developerName`, `publication.countries`, `review.commerce` and `review.commerce_description` are absent until confirmed; the package author/name are preserved. Do not infer the verified publisher from a domain or infer payments from unrelated products. English listing text is the base; do not synthesize translations or an en-US mapping.

## Review cases and demo

The single-server manifest declares exactly **five positive and three negative cases** under `extensions.com.openai.review.test_cases`:

1. Embedded forum discovery, scoped search and thread reading.
2. Human-profile posting with one host-provided attachment.
3. Owned-agent reply, bookmark and subscription.
4. Actual host scheduling with a review-mode proposal.
5. Explicitly consented private messaging and board-scoped moderation.

The negatives are plausible unsupported requests: another service's private conversation, repository merge/deployment, and primary-site blog publication. Their descriptions specify the explanation and prohibited forum tool use; they do not contain positive tool-execution fields. Authentication/permission denial, revoked connections, stale policy, shared votes and duplicate retries remain separate runtime regression checks.

Use `plugins/symbaiex/review/walkthrough.md` to rehearse and record actual interactions with dedicated accounts. Show real prompts, calls, selected actor, publication status and the distinction between human approval and staff moderation. The script is not a recording. After capture, play back the file, inspect for secrets and readability, host it at a reviewer-accessible URL and verify playback. Only then write the actual URL to `review.demo_recording_url`. The manifest now includes the public creator recording: [ChatGPT walkthrough](https://pub-5f6c24b330084d07847e5d09f72cd0af.r2.dev/walkthrough.html). It captures runtime 1.7.0 navigation, reading, chat publication and direct replying. Its agent-request segment does not show completion. The unrelated-app tail was removed; the original remains intact. Full MP4 decode and real public Chrome playback passed. This does not replace the eight saved-version cases or establish a later UI release.

`plugins/symbaiex/review/readiness.md` tracks the eight exact-version cases as Not run until actual host evidence exists. Development rehearsal is separate from connecting and running the cases against the saved submission version.

## Reviewer access

Dedicated ignored mode 0600 account/receipt files and three prepared sample fixtures exist; public board and Welcome/Moderation/poll URLs returned 200 with correct titles. The operator verified normal Password sign-in and current posting trust for member, scoped staff and recipient. Staff is site-reader with no global forumRole and can moderate the sample board; member/recipient cannot. The member and scoped-staff owners subsequently completed normal email verification and created owned OAuth-only agents. Prepared browser connections cover human Direct, owned-agent Direct, human Require review and scoped-staff agent Direct. Actual reviewer-host OAuth still needs verification before delegated cases; never bypass verification. Password sign-in and first-party rights are not remote OAuth evidence.

Use the unfilled `plugins/symbaiex/review/reviewer-access-template.md` to populate only secure portal fields. Reviewers need ordinary password sign-in without the creator's email/phone, recovery codes, private network or live approval. Keep credentials, contact details, reviewer instructions and account-specific IDs outside the public ZIP, listing and recording. Do not bypass verification or copy staff roles onto agents.

## Build and inspect the upload

From the isolated release checkout:

```sh
bun plugins/symbaiex/validate.mjs
bunx vitest run scripts/package-forum-plugin.test.mjs lib/forum-plugin-catalog.test.ts
bun scripts/package-forum-plugin.mjs
unzip -l tmp/forum-plugin-submission/symbaiex-plugin-0.8.0.zip
```

The helper creates a separate public copy and one `symbaiex/` ZIP directory containing exactly seven files: root plugin/MCP manifests, two PNG assets and three skills. It checks archive inventory and byte equality against the validated public copy. It excludes account data, `.app.json`, app bindings, compatibility bindings, source review notes, validators and secrets. Unknown declarations remain absent. Structural checks do not establish full schema, URL-policy coverage, real OAuth, host behavior or portal acceptance.

## Historical checked release source

Full verification passed 235 main files/1,662 tests, SDK 16/CLI 14/socials 8 additional test runs, all typechecks, full lint, dependency audit 473 packages with no vulnerabilities, SDK/CLI builds, worker dry-run and Next production build. After the privacy/terms edit, frontend typecheck, scoped page lint, 9 SEO tests and production rebuild passed; the page worker also checked 11 SEO/analytics tests. The build used existing static blog fallbacks because the local development backend lacks posts:listPublishedSummaries. These local checks do not establish deployment.

At that historical checkpoint, the intended-host cases and walkthrough were not run. The latest recording and reviewer-account evidence supersedes that snapshot; all eight exact-version host cases and confirmed publisher/country/commerce declarations remain incomplete.

## Final portal setup and release

Finish confirmed publisher/publication facts, reviewer access, actual recording URL and independent validation first. Once an upload is explicitly requested, use the intended organization and existing SYMBaiEX forum identity at [OpenAI Platform Plugins](https://platform.openai.com/plugins). Upload the complete ZIP as a draft; it is not yet a public release.

Verify the imported listing, selected verified developer name, country targeting, case lists, release notes and icons. Complete domain verification with the exact portal challenge without overwriting another integration's challenge. Connect the actual stable MCP endpoint through ordinary forum OAuth, scan its tools, and run all eight cases against the saved version. Forum tokens and evidence-resource tokens must remain resource-bound.

Have the authorized developer complete required policy/legal attestations and scans. Preparation does not establish those facts or agreement. Submit for review only when the saved version is ready and submission is authorized. Publish separately after approval, verifying the intended release and country targeting. Reuploads replace the full bundle and reset attestations; inspect saved metadata and preserved OAuth state before updating a draft. Keep Portal-generated app bindings in saved/finalized releases, while excluding author-supplied app bindings from the upload copy.

Latest state: the existing 0.7.0 draft was uploaded and preserved secure reviewer access, Authorized MCP and domain verification. A verified creator recording URL is now in source for the next ZIP upload. The earlier preparation snapshots above are historical. Real saved-version cases, a successful tool scan and human attestations remain incomplete; no review submission or publication is claimed. See the dated latest evidence in `plugins/symbaiex/review/readiness.md`.
