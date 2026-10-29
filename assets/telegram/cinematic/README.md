# SYMF cinematic buy signal

10.8-second silent loop authored in HyperFrames 0.8.209, 960×640 at 24 fps.
The final render is 10.833 seconds after frame rounding. `../symf-buy-cinematic.mp4`
and `../symf-buy-cinematic.gif` are the compact Telegram exports. BuyTech confirmed
its media update in community message 325; real buy message 326 used the GIF.

## Storyboard

Hyperspace streaks → electric portal and physical rings → signal-moth arrival
with hinged wings → flying, glossy extruded `$SYMF BUY` letters → branded hold
→ return to hyperspace. Camera, particles, portal shaders and bloom are computed
from timeline time so render seeking is deterministic.

## Edit and render

Run `npm run dev`, `npm run check`, or `npm run render` from this directory.
The source project with retained HyperFrames history and visual checks is at
`/Users/symbiex/.codex/visualizations/2026/10/27/01a17baf-8fe9-7982-804a-46afd1da2d69/symf-buy-loop`.
The editable preview was served at `http://localhost:3042/#project/symf-buy-loop`.

Visual inspection covered entrance, portal, moth, typography, exit and a decoded
frame from the exported MP4. HyperFrames reported no runtime or layout errors.
Its DOM-only craft detector reported a dead stretch while the GPU canvas was
moving; decoded frames and snapshots show the motion. Motion sidecar assertions
were not enabled, so this is not a claim that they passed.

## Assets and attribution

The signal-moth is AI-generated artwork based on the existing SYMBaiEX Forum
mascot, generated with OpenAI imagegen for this project. Prompt direction: a
cinematic transparent 3D ivory robot moth, black glass face with yellow eyes,
cyan/pink circuit wings, premium physical materials, isolated with no text.
The earlier flat banner is retained as `../symf-buy-alert.png`.

Portal and extruded-letter techniques were adapted from installed HyperFrames
registry blocks `vfx-portal` and `extruded-logo`; the unmodified references and
registry lock/history remain in the source project. Three.js and GSAP load from
version-pinned jsDelivr URLs. Geist Bold typeface and its license are in assets.

The retained `compositions/vfx-portal.html`, `compositions/extruded-logo.html` and
`compositions/components/drift-hold.html` originate from the HyperFrames registry
at v0.8.209 ([upstream source](https://github.com/heygen-com/hyperframes/tree/v0.8.209/registry)).
HyperFrames is by HeyGen and contributors, licensed under Apache-2.0;
see `HyperFrames-LICENSE.txt`. `compositions/cinema.html` adapts portal and
extruded-letter techniques into this project's original scene. Keep this notice
and the upstream license when redistributing the example code. The mascot artwork
retains the separate project brand terms in `ASSETS.md`.

This film contains no token prices, returns, or market-cap claims.
