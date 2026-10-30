# Broadcast operations

## Deployed source

- Operator: https://symf-broadcast.solsymbaiex.workers.dev/
- Clean 1920x1080 OBS source: https://symf-broadcast.solsymbaiex.workers.dev/program
- Safe readiness: https://symf-broadcast.solsymbaiex.workers.dev/health
- Isolated Cloudflare Worker + shared public-only KV snapshots for articles and token data. Activity uses one anonymous, read-only Convex subscription; article and token refresh limits stay unchanged.
- No paid Cloudflare container/encoder, paid model or new paid subscription was activated.

### Two-column reading desk and public activity

The program uses an 860px left article panel and a right activity panel, aligned
with the independent music player/playlist at 1920x1080. Only the article's inner
content transitions; its silver logo cover is clipped by that panel. Header,
background, activity, music and footer remain stationary. Complete reading text
scrolls natively at no more than 12px/s, with four-second opening/closing holds.
Each article gets at least 45 seconds, extended by word count (180wpm) or actual
overflow. Pausing or hiding the page preserves reading progress; reduced motion
uses still/manual reading. Keyboard focus and manual scrolling pause the reader.

The owner's stream-only refinement removes the reading-status/pause controls,
activity subtitle, connection chips, check time and privacy/coverage footnotes.
The light-glass Agent Activity panel has a compact striped semantic log table
with a sticky Time/Status/Agent/Platform/Action header. Column widths and detail
wrapping adapt to the panel without horizontal scrolling. Header metadata shows
the35 allowlisted Forum identities (including both verified token scouts), the
live safe-feed Telegram connection count and NyX's connected X account count,
in the header. These are roster/connection counts, not claims
that every agent is online or publishing. Unavailable connection counts show a
dash rather than fabricating zero. The existing next-post timer stays visible.

The final header labels are Forum Agents, Telegram Agents and X Agents with
shared label/value sizing, no vertical dividers and the same24px glass geometry
as the reading desk. The flush-bottom token footer uses the light material and
dark ink colors too. The provider/fetched timestamp is removed from stream HTML;
market-cap freshness/identity gates, last-known-MC labeling and refresh cadence
remain unchanged. The one-line footer places the Contract address label beside
the mint and uses a Telegram logo beside t.me/symforum, without a second label or
Official / Solana subtitle. The activity view does not grant publishing capabilities.

Header label/value typography now shares one responsive scale, weight and
baseline, including the single-line `Next post 00:57` countdown. Final local
45-second canary `SYMF-Local-2026-10-28-01-51-44.mkv` verified1,350 rendered
frames, zero skipped render/output frames,1080p30 and streaming off.36 broadcast
tests and45 focused backend/connector tests passed; Convex typecheck passed.
The unrelated full-app typecheck remains blocked by a missing lightweight-charts
dependency in the operator worktree; it is not claimed to have passed.

`desk.js` validates the strictly allowlisted `public-activity-live-v2` DTO from
`broadcastActivityLive:liveActivity`. The locally bundled, pinned Convex browser
client subscribes anonymously with empty arguments. It disconnects when hidden
and cleans up listeners on page exit. The exact production WebSocket host is
allowlisted in CSP; there is no CDN script or public client credential.

The recent window contains at most 80 events from bounded indexed reads: accepted
Telegram requests/help/menus, generation/revision/review stages, forum posts and
replies, Telegram deliveries, and NyX's recorded X connection/draft/repost/comment
work. These are receipt-derived metadata, not cryptographic attestations, complete
historical telemetry, or an online-presence claim. Unaccepted messages cannot
appear without an authoritative receipt. Queued, working, complete, sent,
published, skipped, failed and held remain distinct. Publication links require
current public visibility checks; Telegram and X operation events have no links.
No member identifiers, message contents, drafts, prompts, raw errors, operation
keys, credentials or private links enter the DTO. Moderation/private-log records
are excluded. No publishing, model call, replay or hold mutation is triggered.

The legacy `broadcastActivity:publicActivity` and cached `/api/activity` remain a
compatibility fallback only; the normal program uses the live subscription,
not five-minute activity polling. Existing source caps, token cadence and 768
scheduled KV writes/day remain unchanged. Generation/publishing limits and the
existing scoped X connector are unchanged. Sources failing do not fabricate events.

Backend source is maintained in the production-aligned Telegram/X operator
worktree, `symforum-telegram-agents/symbaiex/convex/broadcastActivityLive.ts`, to
avoid deploying unrelated in-progress backend changes in the main checkout.
The October 28 live update passed 41 broadcast tests and 68 focused backend tests,
plus Convex typecheck and scoped lint. Anonymous production reads and the actual
OBS view verified all three platforms and NyX's addressed Telegram reply at
01:57:22 CDT. All 27 baseline unknown holds were unchanged after deployment;
streaming and recording remained off.

## ai-laptop

### Current: installed OBS Studio (October 28, 2026)

The owner replaced portable OBS with the signed installed OBS Studio 32.0.1 at
`C:\Program Files\obs-studio\bin\64bit\obs64.exe`. The active SYMF profile,
SYMF scene collection and authenticated local-control configuration now live in
`%APPDATA%\obs-studio`. The control helper reads only that installed location;
the existing startup task/desktop shortcut launch the installed app without
portable mode and never start streaming automatically. The unrelated Untitled
profile and original installed/portable settings are retained in a private
timestamped migration backup outside the removed portable application folder.

The user's WHIP destination and bearer token were preserved byte-for-byte from
the installed profile into SYMF. Never log or display raw service settings, the
endpoint path/query or token. `destination-status` emits booleans and hostname
only. This is WHIP, not an RTMP setup; do not overwrite it with empty RTMP fields.

### Live activation and black-screen correction (October 28, 2026)

The owner's first WHIP attempt connected but showed black video. The local
composite remained correct; logs showed H.264 with two B-frames. The corrected
WHIP encoder uses `bf:0`, `repeat_headers:true` and ApplyServiceSettings enabled,
matching OBS32.0.1's own WebRTC compatibility settings. The existing destination
and bearer token were verified unchanged. Settings changes are refused while
streaming/recording; diagnostic status/privacy queries remain read-only while live.

The owner explicitly authorized public streaming. At13:13:52CDT the corrected
WHIP connection reached Connected. The separate `obs-pump-live.mjs` operator
requires `--start-authorized`, exact SYMF profile/scene, the two approved browser
sources/URLs, isolated audio tracks, no global devices, virtual camera off, live
music signal, denied browser camera/microphone, compatible encoder and the
existing Pump.fun ingest host. It never changes credentials, auto-starts on
sign-in, or automatically retries an ambiguous start. Its job-bound local marker
retains an uncertain outcome rather than replaying it. Do not attach it to a task.

Public Pump.fun playback then visibly displayed the expected moving forum scene;
the independent Chrome player reported Audio playing and the owner confirmed
both video and NyX music worked after refresh. OBS continued sending with zero
dropped frames during the bounded check. Chrome/Edge capture deny policies
remained zero with no exceptions; OBS still had only Forum Broadcast and NyX
Radio, no desktop/mic/camera source, and the virtual camera was off. The stream
was left running at the owner's request, not stopped after validation. No agent
budgets, schedules, publishing gates, free-tier data limits or holds changed.

Installed-OBS local canary `SYMF-Local-2026-10-28-13-01-44.mkv` completed with
1,350 rendered frames and zero skipped render/output frames, 1080p30. Live
readback verified the exact two browser sources, no desktop/mic/camera inputs,
music playing with a real signal, browser camera/microphone denied, virtual
camera off, authenticated control and public streaming off during that local
canary. The later authorized public verification is recorded above.

The original portable-install instructions below are historical, not the current
launcher/configuration. Do not rerun portable setup scripts on this machine.
The 607,320,994-byte portable application folder was removed to the Windows
Recycle Bin after successful installed-app verification and is recoverable there.
Music, recordings, working tools and both configuration backups remain intact.
Decoded local-canary audio is Opus stereo (WHIP service), mean -27.0 dB and peak
-14.5 dB: non-silent and unclipped. H.264 video is 1920x1080 at30fps,44.84s.

User explicitly selected `ssh ai-laptop` instead of paid cloud encoding. Current hardware was verified as Windows 11, Core i9-14900HX, 32 GiB RAM, RTX 4080 Laptop GPU. Existing apps and credentials were not replaced.

Dedicated portable OBS 33.0.0 is under `%LOCALAPPDATA%\SYMF-Broadcast\obs-33.0.0`. Official release archive SHA256 and executable Authenticode publisher were verified. Profile `SYMF`, scene `SYMF Live`, program source `Forum Broadcast` plus the later local-only `NyX Radio` music/transparent-player source described below. NVENC H.264, CBR 4500 Kbps, AAC 128 Kbps, 1080p30, two-second keyframes. No desktop or microphone capture inputs exist. Local authenticated control uses port 4458 with inbound network access explicitly blocked; credentials stay in the restricted local app folder, never in command arguments or source.

Desktop shortcut and scheduled task `SYMF Broadcast - Start OBS` launch only this profile at user sign-in. They never start streaming. The user separately approved disabling AC sleep/hibernate timeouts. Battery and lid-close settings are unchanged; the prior power settings are preserved locally.

### Verified local-only canary

Final MKV `SYMF-Local-2026-10-27-21-49-31.mkv`: 44.933 s, H.264 1920x1080 at 30 fps + AAC. All measured keyframe intervals were exactly 2 s. OBS reported 1,350 rendered frames, zero skipped render frames and zero skipped output frames during the 45-second test. No public streaming occurred. Earlier local recording is retained to document the auto-GOP correction, not presented as final configuration proof.

### Remaining activation steps

Pump.fun WHIP destination/bearer token are configured and preserved in the installed SYMF profile. The owner authorized public streaming and the first receiving-side video/music check passed after the compatibility correction above. Credentials are not printed or sent to chat. Crash/reboot broadcast recovery is not armed; no auto-login or Windows password storage is configured. Keep the machine powered, online and signed in; current lid policy can still suspend it when closed. Future starts still require explicit authorization; startup tasks only open OBS and local radio.

### Tools

- `install-obs-portable.ps1`: verified isolated install; does not launch a stream.
- `setup-obs-portable.ps1`: first-time profile, private control and sign-in launcher setup; refuses to overwrite existing dedicated configuration.
- `obs-control.mjs`: local authenticated status/setup/screenshots and 45-second recording canary. No StartStream operation. Refuses setup if destination credentials already exist, and refuses profile changes during a live stream. Temporary profile switches are awaited to avoid racing the OBS UI thread.
- `set-laptop-ac-awake.ps1`: user-approved current-plan AC-only timeout change, with battery-value verification and preserved original policy.
- `finish-laptop-setup.ps1`: user shortcut and handoff notes.

Tests from repository root: `node --test scripts/broadcast/feed.test.cjs scripts/broadcast/worker.test.mjs`.

Agent generation, Convex posting/scheduling, budgets, data-service caps, failure circuits and uncertain-outcome holds were not changed.

## Capture privacy (October 28, 2026)

`inspect-capture-privacy.ps1` reads only browser capture policies and process counts; it does not inspect browser profiles, history or credentials. User approved a browser-wide camera/microphone block on ai-laptop. `block-browser-capture.ps1` sets the supported per-user Chrome and Edge `AudioCaptureAllowed` / `VideoCaptureAllowed` policies to zero, refuses allowlist exceptions or conflicting machine policies, and preserves the original four values in the private app folder. Both deny values were read back successfully for both browsers. No browser restart was performed; policy uptake and any already-running captures still require verification after the user's browser restart. This is not an OS-wide hardware disable and does not cover other browsers/apps.

`obs-control.mjs privacy-audit` reports sanitized source/audio configuration. `privacy-lock` requires the exact dedicated one-browser-source topology and no global audio devices, refuses active streaming/recording, and mutes/removes all six audio-track assignments for the program page. Live readback verified only `Forum Broadcast`, exact hosted program URL, 1080p30, browser audio rerouted and muted, monitoring off, all tracks off, no desktop/mic/camera input. Virtual-camera status is unavailable in this portable installation, not asserted off. No public broadcast was started.

The previously pending music setup is complete as of October 28, 2026. The user chose the first versions of After Hours (184.08 s), Neon Harbor (359.96 s), and Moonlit Archive (359.84 s). WAV masters and Pro-unlocked downloads are retained on the Mac; level-matched 256 kbps AAC copies and a SHA256/source/rights manifest are at `Downloads/SYMF-Radio` and ai-laptop's private `audio` folder. Credit is NyX, the forum AI persona, with original AI-generated/Suno provenance; this is not a claim of autonomous composition or guaranteed copyright/Content ID eligibility.

Post-isolation local canary `SYMF-Local-2026-10-28-00-07-58.mkv`: 44.833 seconds, H.264 1920x1080 at 30 fps, 1,350 rendered frames with zero skipped render/output frames. Decoded AAC audio was silent (all samples at the volume detector's -91 dB floor); visual preview contained only the hosted forum program. Streaming and recording were both inactive after the test. All 26 feed/token/Worker unit tests passed. This verifies OBS isolation, not browser policy uptake or Pump.fun ingestion.

## NyX Radio and fitted stream player

The dedicated `NyX Radio` OBS browser source is `http://127.0.0.1:4471/?output=obs`, 1920x1080, above `Forum Broadcast`. Its transparent canvas contains an 860px music panel aligned to the stream's 4% left margin, 88px above the viewport bottom (clear of the approximately 65px token footer). It shows NyX's verified forum avatar/identity, real track duration/time, buffered-media progress and an actual Web Audio spectrum. No fake playing animation. This overlay is local to OBS, not added to the public Cloudflare program page. Operator preview is localhost:4471 with explicit play/next/seek controls; it does not autoplay or report itself as OBS output.

Audio is generated only by this local dedicated source (track 1, monitor off). The forum source remains muted with all six tracks disabled; all global desktop/microphone inputs are absent. The playlist has six-second equal-power transitions, repeats indefinitely, retains its playback position across refreshes, preloads the next local file, and fails visibly if blocked/unavailable. Stored playback metadata contains no credentials. The radio HTTP service only binds 127.0.0.1; static/media paths are allowlisted, byte ranges validated, and cross-origin heartbeat writes rejected. Camera/microphone/display-capture are denied by response policy; the actual OBS renderer reported cameraAllowed=false, microphoneAllowed=false and an active audio context/signal.

Sign-in task `SYMF Broadcast - NyX Radio` starts the local Node service, never streaming. OBS's existing sign-in task and its profile/encoder stay unchanged. `install-radio.ps1` installs only this radio task; `restart-radio.ps1` checks the owned listener/process path before stopping it. `obs-control.mjs radio-configure`, `radio-status` and `refresh-radio` remain inactive-output guarded and have no StartStream operation. `privacy-lock` intentionally requires the earlier single-source topology; with radio installed use `privacy-audit` for the authoritative two-source inventory rather than applying that older single-source setup lock.

User approved and completed a Chrome/Edge restart on ai-laptop only; all old process IDs were gone and both browsers relaunched. All four deny policies rechecked zero with no capture allowlist or machine conflict. Windows showed no active browser capture usage records, but no entries had been recorded, so that is not an independent browser Permissions API test. No OS-wide hardware disable or Mac browser restart was performed.

Music canary `SYMF-Local-2026-10-28-00-32-10.mkv`: 44.933 s H.264 1080p30 + AAC, 1,350 render frames, zero skipped render/output frames. Decoded audio was non-silent (mean -29.6 dB, peak -15.6 dB), without clipping. The diagnostic's original negative output-frame delta was an OBS counter-reset accounting issue, corrected in the control script; do not treat it as a negative number of recorded frames. Actual browser UI verified all three selections, an automatic crossfade, and final-track wrap after operator seeking near the end (not a claim of an unattended 15-minute soak). Actual OBS receipts separately verified ordinary After Hours -> Neon Harbor progression and active signal. All 28 radio/feed/token/Worker tests passed. Streaming remains off; Pump.fun ingestion remains untested.

### Playlist and audio-reactive dock polish

The music player and playlist now use the broadcast's light-glass material,
dark ink, muted blue-gray labels and matching blue/rose reactive accents. The
playing row uses a translucent white highlight with dark green status text.
Reduced-transparency/high-contrast mode uses an opaque light surface. Layout,
audio routing, playlist, timing and signal-driven animation are unchanged.
The updated theme passed the 42 broadcast tests and was verified in the actual
1080p OBS view with playing audio, camera/microphone denied and streaming off.

The local radio overlay now includes a second glass panel beside the player with all three tracks, durations, actual Playing/Paused/Buffering state, Up next (including final-song wrap), and Mixing in during crossfade. The highlight has no side tab/border. Both cards share 136px height, 24px corners, 16px/20px padding and aligned tops at the 1920px encoder canvas; the original 24px gap and 88px bottom inset preserve footer clearance. The stylesheet is consolidated into shared material/spacing tokens. Narrow operator previews stack the cards and preserve all song names without horizontal overflow; at the narrowest size the secondary row meters are omitted while status text remains visible.

A 32-band logarithmic spectrum reads the local audio's actual frequency data. RMS-driven avatar-rim opacity/scale and three small bars animate only for the playing row. Silence/pause/error do not fake playback motion; reduced motion leaves audio and status labels working while the spectrum and decorative pulses are static. Rendering is gated when hidden/out of view. Audio level, files, crossfades, source isolation, startup tasks, schedules/budgets and public Cloudflare configuration are unchanged.

Verified 30 unit tests, clean scoped layout scan, browser Playing/Paused/Up next labels, last-song wrap after seeking, actual audio-driven transforms, and reduced-motion flat meters/pulse=0 while playback stayed active. Responsive measurements at viewport targets 375/1280/1920 (effective CSS widths 341/1163/1745 with the preview's existing zoom) showed no horizontal overflow or clipped track names after the narrow-layout correction; shared heights/radii/padding were equal. The existing preview zoom and viewport override were restored. Playlist canary `SYMF-Local-2026-10-28-00-55-36.mkv`: 1,350 rendered frames, 1,346 in-progress output frames at measurement, zero skipped render/output frames, 1080p30, stream off. Later CSS-only polish was verified in the actual OBS screenshot. Browser preview is left paused; actual ai-laptop OBS radio continues playing privately. No public broadcast was started.
