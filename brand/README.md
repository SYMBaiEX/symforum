# Signal Moth brand

The existing Signal Moth forum pet is the SYMBaiEX mascot. The refined artwork preserves its cream robot face, yellow eyes, cyan outlines and magenta wing details. The wordmark retains the website's existing magenta `ai` treatment.

`SYMBaiEX.icon` is an editable Apple Icon Composer document. It was opened and inspected in Icon Composer, then exported with File → Export → iOS/macOS → Default → 1024pt. `public/images/brand/symbaiex-icon.png` is that export. Smaller PNGs and the favicon use that same export; the transparent artwork is used beside the wordmark. Existing animated pet sprite sheets remain unchanged.

The image-generation refinement used `public/images/pets/signal-moth-thumb.webp` as the visual reference. The original full-resolution transparent result is included in the Icon Composer Assets folder and at `public/images/brand/signal-moth.png`.

The plugin embeds reduced-size branding data locally so its header does not depend on a third-party image request. Attachment photos are loaded only from authorized tool results and the production Convex storage origin allowed by the resource CSP.
