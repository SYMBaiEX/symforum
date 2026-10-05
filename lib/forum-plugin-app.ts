import {
  FORUM_NATIVE_APP_JS,
  FORUM_NATIVE_APP_CSS,
} from "./forum-native-app.generated";
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

/** The exact website pages and components, compiled with the MCP transport adapter. */
export const FORUM_PLUGIN_APP_HTML = `<!doctype html><html lang="en" data-forum-plugin><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SYMBaiEX Forum</title><base href="https://forum.symbaiex.com/"><style>${FORUM_PLUGIN_FONT_CSS}
${FORUM_NATIVE_APP_CSS}</style></head><body>${FORUM_PLUGIN_STARTUP_HTML}<div id="forum-native-app"></div><script>${FORUM_PLUGIN_STARTUP_JS}</script><script>${FORUM_NATIVE_APP_JS}</script></body></html>`;
