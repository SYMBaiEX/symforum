import { FORUM_NATIVE_APP_CSS, FORUM_NATIVE_APP_JS } from "./forum-native-app.generated";
import { FORUM_PLUGIN_FONT_CSS } from "./forum-shared-css.generated";
import { FORUM_PLUGIN_STARTUP_HTML, FORUM_PLUGIN_STARTUP_JS } from "./forum-plugin-startup";

import { FORUM_NATIVE_RESOURCE_URI } from "./forum-native-revision.generated";

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
    ui: {
      prefersBorder: false,
      csp: {
        connectDomains: [],
        resourceDomains: [
          "https://strong-bee-384.convex.cloud",
          "https://forum.symbaiex.com",
          "https://www.symbaiex.com",
          "https://lh3.googleusercontent.com",
        ],
        frameDomains: [],
      },
    },
  },
} as const;

export const FORUM_PLUGIN_ASSET_REVISION = FORUM_NATIVE_RESOURCE_URI.match(/forum-([a-f0-9]{12})\.html$/)![1];
export const FORUM_PLUGIN_ASSET_ORIGIN = "https://www.symbaiex.com";
export const FORUM_PLUGIN_ASSET_PATH = `/api/plugin/assets/${FORUM_PLUGIN_ASSET_REVISION}`;
export const FORUM_PLUGIN_APP_CSS = `${FORUM_PLUGIN_FONT_CSS}\n${FORUM_NATIVE_APP_CSS}`;
// Deliver styles and their matching component code as one generation, even
// when the host retains a previously read loading document between deployments.
export const FORUM_PLUGIN_APP_SCRIPT = `(() => {const style=document.createElement("style");style.textContent=${JSON.stringify(FORUM_PLUGIN_APP_CSS)};document.head.append(style);})();\n${FORUM_NATIVE_APP_JS}`;

/** Keep the MCP document small; the same generated forum UI loads from owned assets. */
export const FORUM_PLUGIN_APP_HTML = `<!doctype html><html lang="en" data-forum-plugin><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SYMBaiEX Forum</title><style>html{color-scheme:dark}body{margin:0;background:#0c0c0e;color:#fafafa}</style></head><body>${FORUM_PLUGIN_STARTUP_HTML}<div id="forum-native-app"></div><script>${FORUM_PLUGIN_STARTUP_JS}</script><script defer src="${FORUM_PLUGIN_ASSET_ORIGIN}/api/plugin/assets/current/forum.js"></script></body></html>`;
