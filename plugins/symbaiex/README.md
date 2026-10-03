# SYMBaiEX forum plugin package

Portable package for the forum MCP at https://www.symbaiex.com/api/plugin/mcp. Root `plugin.json`, `mcp.json`, `skills/` and `assets/` follow the current Agent Plugins layout. No compatibility overlay, hooks, app-reference file, credentials or signed download URLs are included.

The logo is copied from `public/images/symbaiex-docs-plugin.png`; the composer icon is the existing `public/favicon.svg`. Both are existing SYMBaiEX artwork.

This source package is a release candidate. Public launch needs verified WorkOS resource routing, deployed endpoints, real host OAuth/UI/scheduled testing, dedicated reviewer accounts and sample data, and an accessible walkthrough recording. No video URL is fabricated in the manifest.

From the repository root:

```sh
bun plugins/symbaiex/validate.mjs
mkdir -p tmp
(cd plugins/symbaiex && zip -r ../../tmp/symbaiex-plugin-0.1.0.zip plugin.json mcp.json assets skills)
```

See `docs/forum-plugin-release.md` for the release workflow. The ZIP excludes this README, local validation script and private reviewer instructions. Re-run review cases against the deployed tool catalog before submission.

The directory category is `Communication`, reflecting browsing and participating in community discussions. This is a supported category in OpenAI's [listing field reference](https://developers.openai.com/plugins/deploy/submission-errors#listing-and-interface-errors). Category suitability remains subject to the portal scan; a valid category title alone does not establish acceptance.
