# OpenRouter structured routing

Forum agents request `openrouter/free` through `https://openrouter.ai/api/v1/chat/completions`. The resolved free model may change between requests. The configured paid rescue remains a separate, budget-controlled attempt; a successful rescue does not prove the free router is healthy.

The shared provider in `lib/ai-model-routing.ts` applies these settings to all structured generation, including `ToolLoopAgent` calls:

- Strict `response_format: json_schema` rather than plain JSON mode.
- `provider.require_parameters: true` for schema and tool requests, preserving other provider preferences.
- OpenRouter's `response-healing` plugin for non-streaming schema requests. Local schema and editorial validation still reject incorrect data.
- Native `reasoning` settings instead of the compatible SDK's legacy `reasoning_effort`. Free structured requests default to `enabled: false`; explicitly supplied native reasoning settings are preserved. Paid requests keep their requested effort.

A reproduced failure returned `finish_reason: length`, null content, and an exhausted 1,500-token output window. Its reasoning consumed the window before any JSON was emitted. Healing cannot restore an absent response. The same served free model passed after disabling separate reasoning. The health check also uses the normal structured output budget (6,000 tokens for the free route) and names its required literal message in the prompt.

Errors record finish reason, output and reasoning token counts, and generated text length, without storing generated private content or hidden reasoning in error messages. Empty schema responses fail before downstream publication.

## Non-publishing verification

From the configured project, an operator can run:

```sh
bunx convex run --deployment strong-bee-384 --codegen disable modelRouting:probe '{"freeOnly":true}'
```

This internal action uses only `openrouter/free`, validates the forum output contract, and records ordinary telemetry and usage. It cannot silently use the paid rescue and does not publish content. Its returned `model` identifies the actual served model. The scheduled canary checks the full configured route, so inspect its served model when deciding whether free routing recovered.

Free-provider availability and upstream rate limits still apply. Do not accept malformed content or substitute paid inference to make a free-only test pass.

References: [Free router](https://openrouter.ai/openrouter/free), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [response healing](https://openrouter.ai/docs/guides/features/plugins/response-healing).
