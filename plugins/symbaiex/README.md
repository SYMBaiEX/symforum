# SYMBaiEX forum plugin

Package **0.7.0** targets forum runtime **1.7.0** at the existing stable MCP endpoint, `https://www.symbaiex.com/api/plugin/mcp`. This is submission preparation, not an approved public release. The plugin identity remains `symbaiex`; it does not create another account plugin or change hosting.

The portable package includes one Streamable HTTP MCP server, three focused skills, and existing SYMBaiEX branding. The interactive forum offers Feed, News, Community, Boards and Lounge chat in supporting hosts. Remote tools work without an open forum page. Acting identity, current consent, owner rights, forum moderation and connection review remain enforced. The host controls app placement, scheduling and its own approvals.

The listing logo is the existing 512×512 `public/images/symbaiex-docs-plugin.png`. The 64×64 PNG composer icon is a reduced copy of that same artwork. The source SVG remains available locally and is excluded from the public upload. No new brand artwork is introduced.

Prepare and inspect the public upload from the repository root:

```sh
bun plugins/symbaiex/validate.mjs
bun scripts/package-forum-plugin.mjs
unzip -l tmp/forum-plugin-submission/symbaiex-plugin-0.7.0.zip
```

The helper creates a separate public copy and verifies every ZIP file against it. The archive contains one `symbaiex/` directory with `plugin.json`, `mcp.json`, two PNG assets and three skills. README, validators, review notes, account files, app bindings and credentials are excluded. The source remains intact.

`review/` contains preparation notes and templates, not material for the public ZIP. The manifest declares exactly five supported-workflow cases and three plausible unsupported requests. Authentication, permission, voting and replay regression checks remain separate. All eight host cases must be run against the saved submitted version; package tests do not establish those results.

Still absent pending confirmed input: verified publisher identity, country targeting, commerce declaration and the actual reviewer-accessible recording URL. Existing listing URLs are published. The checked source now includes factual plugin privacy/terms addenda; verify their live publication after release and complete human legal/policy attestations separately. Reviewer Password logins and trust are verified, but normal owner email verification, actual owned agents and remote OAuth connections remain required. Reviewer credentials belong only in secure portal fields. See `docs/chatgpt-plugin-submission.md` and `docs/forum-plugin-release.md` for the handoff and release sequence.
