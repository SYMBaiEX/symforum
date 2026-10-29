import { FORUM_NATIVE_APP_CSS, FORUM_NATIVE_APP_JS } from "./forum-native-app.generated";
import { FORUM_PLUGIN_FONT_CSS } from "./forum-shared-css.generated";
import { FORUM_PLUGIN_STARTUP_HTML, FORUM_PLUGIN_STARTUP_JS } from "./forum-plugin-startup";

import { FORUM_NATIVE_RESOURCE_URI } from "./forum-native-revision.generated";
import { PRIMARY_SITE_URL, FORUM_SITE_URL } from "./site-urls";
import { installation } from "./installation";
import { installationOrigin } from "./installation-config";

const backendOrigin = process.env.NEXT_PUBLIC_CONVEX_URL
  ? installationOrigin(process.env.NEXT_PUBLIC_CONVEX_URL)
  : "";

const FORUM_PLUGIN_CSP = {
  connectDomains: [],
  resourceDomains: [
    ...backendOrigin ? [backendOrigin] : [],
    FORUM_SITE_URL,
    PRIMARY_SITE_URL,
    "https://lh3.googleusercontent.com",
  ],
  frameDomains: [],
} as const;

export const FORUM_PLUGIN_APP_RESOURCE = {
  uri: FORUM_NATIVE_RESOURCE_URI,
  name: "symbaiex-forum",
  title: "SYMBaiEX Forum",
  description:
    "Read the news, browse community discussions, and participate in the SYMBaiEX forum.",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    "openai/ui": {
      availableDisplayModes: ["fullscreen"],
      preferredDisplayMode: "fullscreen",
    },
    // Keep ChatGPT's older widget CSP reader in sync with the MCP Apps field.
    "openai/widgetCSP": {
      connect_domains: FORUM_PLUGIN_CSP.connectDomains,
      resource_domains: FORUM_PLUGIN_CSP.resourceDomains,
      frame_domains: FORUM_PLUGIN_CSP.frameDomains,
    },
    ui: {
      prefersBorder: false,
      csp: FORUM_PLUGIN_CSP,
    },
  },
} as const;

export const FORUM_PLUGIN_ASSET_REVISION = FORUM_NATIVE_RESOURCE_URI.match(/forum-([a-f0-9]{12})\.html$/)![1];
export const FORUM_PLUGIN_ASSET_ORIGIN = PRIMARY_SITE_URL;
export const FORUM_PLUGIN_ASSET_PATH = `/api/plugin/assets/${FORUM_PLUGIN_ASSET_REVISION}`;
export const FORUM_PLUGIN_APP_CSS = `${FORUM_PLUGIN_FONT_CSS}\n${FORUM_NATIVE_APP_CSS}`;
// Deliver styles and their matching component code as one generation, even
// when the host retains a previously read loading document between deployments.
export const FORUM_PLUGIN_APP_SCRIPT = `(() => {const style=document.createElement("style");style.textContent=${JSON.stringify(FORUM_PLUGIN_APP_CSS)};document.head.append(style);})();\n${FORUM_NATIVE_APP_JS}`;

/** Keep the MCP document small; the same generated forum UI loads from owned assets. */
const nativeConfiguration = JSON.stringify({ installation: JSON.stringify(installation), convexUrl: backendOrigin }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
export const FORUM_PLUGIN_APP_HTML = `<!doctype html><html lang="en" data-forum-plugin><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${installation.name}</title><style>html{color-scheme:dark}body{margin:0;background:#0c0c0e;color:#fafafa}</style></head><body>${FORUM_PLUGIN_STARTUP_HTML}<div id="forum-native-app"></div><script>globalThis.__FORUM_PUBLIC_CONFIG__=${nativeConfiguration};</script><script>${FORUM_PLUGIN_STARTUP_JS}</script><script defer src="${FORUM_PLUGIN_ASSET_ORIGIN}/api/plugin/assets/current/forum.js"></script></body></html>`;
