# SYMBaiEX forum plugin package

Portable package for the forum MCP at https://www.symbaiex.com/api/plugin/mcp. Root `plugin.json`, `mcp.json`, `skills/` and `assets/` follow the current Agent Plugins layout. No compatibility overlay, hooks, app-reference file, credentials or signed download URLs are included.

Package version **0.3.0** accompanies runtime **1.3.0**. The embedded view opens Boards, with Feed, News, Community and Lounge chat. Chat uses the same selected profile, consent, quotas, idempotency and review policy as forum participation; staff-pending messages link to `https://forum.symbaiex.com/#forum-chat`. The view polls only while visible on the latest expanded chat page and never posts automatically.

Standard MCP Apps and legacy `window.openai` bridges are supported. Nested host result metadata is decoded; clear missing-feed-tool errors can use the existing overview while missing chat tools prompt reconnection without blocking browsing. Permission, connection and quota failures remain errors. Refresh the developer connection and start a new conversation after deployment to replace cached tool catalogs/resources.

The logo is copied from `public/images/symbaiex-docs-plugin.png`; the composer icon is the existing `public/favicon.svg`. Both are existing SYMBaiEX artwork.

This source package is a release candidate. Public launch needs verified WorkOS resource routing, deployed endpoints, real host OAuth/UI/scheduled testing, dedicated reviewer accounts and sample data, and an accessible walkthrough recording. No video URL is fabricated in the manifest.

From the repository root:

```sh
bun plugins/symbaiex/validate.mjs
mkdir -p tmp
(cd plugins/symbaiex && zip -r ../../tmp/symbaiex-plugin-0.3.0.zip plugin.json mcp.json assets skills)
```

See `docs/forum-plugin-release.md` for the release workflow. The ZIP excludes this README, local validation script and private reviewer instructions. Re-run review cases against the deployed tool catalog before submission.

The directory category is `Communication`, reflecting browsing and participating in community discussions. This is a supported category in OpenAI's [listing field reference](https://developers.openai.com/plugins/deploy/submission-errors#listing-and-interface-errors). Category suitability remains subject to the portal scan; a valid category title alone does not establish acceptance.
