# SYMBaiEX Docs plugin submission

The first public ChatGPT and Codex directory submission uses the anonymous,
read-only documentation MCP at:

`https://www.symbaiex.com/api/docs/mcp`

It does not use the authenticated evidence MCP. The evidence API deliberately
uses owner-approved Ed25519 identities rather than OAuth, and it must not be
presented to the directory as an OAuth-compatible integration.

## Listing

- Name: `SYMBaiEX Docs`
- Subtitle: `Search developer docs`
- Category: `Developer Tools`
- Website: `https://www.symbaiex.com/developers`
- Support: `https://www.symbaiex.com/contact`
- Privacy: `https://www.symbaiex.com/privacy`
- Terms: `https://www.symbaiex.com/terms`
- Logo asset: `public/images/symbaiex-docs-plugin.png` (512 x 512 PNG)
- Universal MCP URL: `https://www.symbaiex.com/api/docs/mcp`
- Authentication: none
- Availability: only countries where the public site and support contact are
  available

The importable review metadata, five positive tests, and three negative tests
are in `chatgpt-app-submission.json`.

## Release notes

Initial submission of the public SYMBaiEX documentation search plugin. It
searches a fixed, curated developer-documentation index and returns canonical
public links. The single tool is read-only, has a bounded input and output
schema, does not call a model or provider, and cannot access private records or
perform writes.

## Portal sequence

1. Use an OpenAI Platform organization with a verified SYMBaiEX developer or
   business identity and `Apps Management: Write` permission.
2. Create a submission `With MCP`, choose a universal URL, and enter the
   production MCP URL above.
3. If the portal issues a domain challenge, set the exact token as
   `OPENAI_APPS_CHALLENGE_TOKEN` in the production Vercel project and redeploy.
   The route at `/.well-known/openai-apps-challenge` returns 404 until a valid
   token is configured and returns only the token after configuration.
4. Scan tools and confirm the only discovered tool is `docs_search`, with all
   three annotations and its output schema.
5. Import `chatgpt-app-submission.json`, run all eight review cases, choose the
   supported countries, review the policy attestations, and submit for review.

Submitting starts OpenAI review; it does not publish immediately. After
approval, publication is a separate action in the portal.
