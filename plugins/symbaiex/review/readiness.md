# Submission preparation — 0.8.0 / runtime target 1.8.0

This file is source-only and excluded from the public ZIP. It records preparation, not a submission or approval.

## Latest evidence — 2026-10-03, after creator recording

- Runtime 1.7.0 was verified deployed on both stable forum MCP origins. The earlier verification and account snapshots below describe preparation time, not the latest state.
- Member and scoped-staff owners completed normal email verification and have real owned OAuth-only agents. Prepared browser connections cover human Direct, owned-agent Direct, human Require review and scoped-staff agent Direct. Password sign-in remains verified; reviewer remote OAuth still requires an actual reviewer-host connection.
- Existing OpenAI draft 0.7.0 was uploaded. Its secure reviewer fields, Authorized MCP connection and domain verification were preserved. Latest observed scan could not finish; no successful scan or public submission is claimed.
- Creator recording: `https://pub-5f6c24b330084d07847e5d09f72cd0af.r2.dev/walkthrough.html`. Public HTTPS video returned 200 with video/mp4 and byte-range support; Chrome loaded and played it without login. The local MP4 fully decoded without error, 2560×1532, 141 seconds, no audio.
- The derivative retains original seconds 0–141 at normal speed; the unrelated-app tail was removed. The Desktop original is unchanged. Observed: feed/board navigation, thread reading, Lounge chat published, direct reply published and an agent Research-post request still in progress. No completed agent-created Research post is shown.
- This is a runtime 1.7.0 demonstration, not proof of the exact five positive/three negative cases. Their Not run statuses below remain unchanged. The new sidecar parity pass targets runtime 1.8.0/package 0.8.0 and needs updated intended-host evidence before review submission.

## Sidecar parity validation — 2026-10-03

The runtime 1.8.0 source passed the full main regression suite (235 files / 1,669 tests), full ESLint and frontend typecheck. After the final board-navigation correction, all 75 embedded runtime tests and the production rebuild passed. Desktop and 390px browser checks used live public forum reads through a simulated host bridge; mobile clientWidth and scrollWidth both measured 390. These layout checks do not establish authenticated ChatGPT-host behavior. The public package validates seven files and exactly five positive / three negative cases.

## Prepared

- Stable identity `symbaiex`, one MCP endpoint `https://www.symbaiex.com/api/plugin/mcp`, existing hosting and OAuth resource preserved.
- Listing name SYMBaiEX; subtitle Read and discuss forum topics (28 characters); Communication category retained.
- Exactly five positive cases with setup, real tool names/important arguments and observable results; three out-of-scope negative cases with prohibited forum tool use in their descriptions.
- Listing logo PNG 512×512; composer PNG 64×64 copied from the same existing artwork. Opaque near-black background provides contrast on light/dark hosts.
- Public-copy packager verifies exact seven-file ZIP inventory and byte equality. Public upload excludes `.app.json`, all app bindings, source review notes and credentials.
- All current tool annotations expose boolean readOnlyHint, openWorldHint and destructiveHint; catalog regression checks retained.

## Historical public URL and fixture inspection — 2026-10-03

Direct HTTPS requests with Accept: text/html returned 200 and the expected content for:

| Listing field | URL | Content inspected |
| --- | --- | --- |
| websiteURL | https://forum.symbaiex.com/ | SYMBaiEX forum navigation and community purpose |
| supportURL | https://www.symbaiex.com/contact | Publisher contact details and contact form |
| privacyPolicyURL | https://www.symbaiex.com/privacy | SYMBaiEX public forum, connected applications, operational records and deletion requests |
| termsOfServiceURL | https://www.symbaiex.com/terms | Terms explicitly applying to website, forum, agent interfaces, APIs and MCP tools |

The checked source now includes factual privacy/terms addenda covering human-or-owned-agent selection, explicitly authorized personal/private/staff access, OAuth-only profiles without signing keys, attachment bytes/metadata without retained temporary import URLs, and exact delegated payload/result/actor/policy records. Approval eligibility ends after 24 hours; records persist after expiry or disconnection. Disconnection revokes access without deleting profiles, content, receipts or provider consent. These source addenda have not yet been verified at the published URLs; verify their actual live content after release. Human legal/policy attestations remain a separate operator responsibility.

Ignored reviewer credential and content-receipt files remain mode 0600. The sanitized receipt reports three prepared active fixtures: Welcome, Moderation rehearsal and voting rehearsal; known public board/thread URLs returned 200 with correct titles. The release operator subsequently verified all three existing Password logins and current posting trust through normal first-party reads, without changing accounts or bypassing verification. Scoped staff retains site role reader, no global forumRole, and canModerate=true for the sample Plugin Review board. Member and recipient have canModerate=false for that board. All three accounts report emailVerified=false, canEnrollAgent=false, agents=[] and connections=[]. Actual owned profiles and remote OAuth connections are not prepared: complete the owners’ normal contact-email verification before agent enrollment and then use ordinary consent. Existing Password login does not establish OAuth or delegated-agent access.

## Historical checked source — 2026-10-03

`bun run verify` passed: 235 main test files / 1,662 tests; additional SDK 16, CLI 14 and socials 8 test runs; frontend, Convex and social-worker typechecks; full ESLint; SDK/CLI builds; Wrangler dry-run; Next production build with 101 static pages. The production dependency audit checked 473 packages with no vulnerabilities. Workspace test runs may repeat tests in the main suite; these are execution counts rather than a unique aggregate.

Privacy/terms source landed after the full run. Additional frontend typecheck, scoped page lint, 9 SEO tests and a production rebuild passed; the page worker also checked 11 SEO/analytics tests and static bodies/headings/date metadata. Build warnings are the existing local development backend’s absent posts:listPublishedSummaries function; static blog fallbacks completed successfully. No deployment is established by these checks.

At that preparation checkpoint, real-host review cases and walkthrough/video were not run. A saved browser-access restriction persists and the local preview is denied; source/package tests do not establish embedded-host execution. Publisher, country targeting, commerce and actual public recording declarations remain absent pending confirmed input.

## Exact submitted-version host cases

| Case | Result | Required evidence |
| --- | --- | --- |
| P1 Embedded discovery/search/read | Not run | Actual forum_open view and category/search/thread tool results |
| P2 Human post + supplied attachment | Not run | Acting identity, owned upload, one receipt, stable link and publication status |
| P3 Owned-agent reply + follow | Not run | Actual selected agent, AI label, reply and saved/subscribed states |
| P4 Host schedule + owner review | Not run | Host scheduling receipt and actual run returning pending_approval; owner approval separately |
| P5 PM + scoped moderation | Not run | Selected actor mailbox, recipient/message IDs, seeded thread locked within assigned board |
| N1 Other-service private conversations | Not run | Boundary explanation, no forum_* invocation or fabricated summary |
| N2 Repository merge/deployment | Not run | Boundary explanation, no forum_* invocation or fabricated deployment |
| N3 Blog publication | Not run | Boundary explanation, no forum_* invocation or substituted forum post |

Record Passed, Failed, Blocked or Not run with real call/argument/result evidence after execution. Keep these statuses out of manifest case objects. Authentication and validation errors do not replace the three negative routing cases.

## Preparation gaps, in order

1. Confirm the intended verified individual/business identity, supported countries (or explicit all-available choice), and whether this plugin involves payments/purchases. Write only confirmed values to developerName, publication.countries and review.commerce/commerce_description. Do not infer them from the website.
2. Verify the privacy/terms addenda at the live URLs and complete reviewer-host OAuth using the prepared verified owners and owned profiles. Keep legal/policy attestations with the authorized human.
3. The hosted creator recording and manifest URL are verified. Capture the redesigned runtime 1.8.0 in the intended host and run all eight saved-version cases. Resolve the persisted ChatGPT browser-access restriction through the supported host path; local layout previews cannot establish ChatGPT execution.
4. Run final package checks and inspect the final ZIP. Upload as a draft only when requested, into the intended organization and existing plugin identity. Verify saved metadata, actual MCP OAuth connection and all eight cases.
5. The authorized developer completes domain/developer verification, scans and legal/policy attestations. Submission begins review; publishing an approved release is separate.

Publisher/country/commerce declarations have not been synthesized. The latest recording URL is verified above. A structurally valid ZIP with these gaps is **not ready to submit**.
