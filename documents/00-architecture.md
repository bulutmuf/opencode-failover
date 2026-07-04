# 00 — Architecture

## Goal

Rotate API keys across multiple keys for the same opencode provider so that
rate-limited or auth-failing keys are skipped and the next healthy key is
used on the following request.

## Hook surface (used in v1)

opencode's V1 plugin SDK (`@opencode-ai/plugin`) exposes three hooks that
together implement failover without owning the provider:

- **`chat.headers`** — invoked before every LLM request. The plugin picks a
  key from the pool and writes `Authorization: Bearer <key>` (configurable
  header / scheme) into `output.headers`. opencode then performs the actual
  request with those headers.
- **`event`** — universal event subscriber. The plugin listens for
  `event.type === "session.error"`, reads `event.properties.error` (a
  `SessionV1.APIError` shape with `statusCode`, `responseHeaders`,
  `responseBody`, `message`), classifies it, and mutates the key pool.
- **`tool`** — a single tool `keychain.status` is registered so the LLM and
  the TUI slash command surface can inspect live key state.

A `provider` hook (registering a virtual provider id and listing models) is
deliberately out of scope for v1. It would couple the plugin to AI SDK
delegation and require model catalogue maintenance. v2 may add it.

## Why chat.headers and not a custom fetch interceptor

opencode's AI SDK + native runtime path already owns fetch. The only seam a
plugin has into the outbound request is `chat.headers`. Two in-tree plugins
already rely on this pattern (`packages/opencode/src/plugin/github-copilot/
copilot.ts:360` and `packages/opencode/src/plugin/openai/codex.ts:540`), so
it is the established path.

## Why session.error and not tool.execute.after

`tool.execute.after` only covers tool calls, not the message-step LLM call.
`session.error` is the only event that carries the full `Assistant.fields.
error` payload, which includes `statusCode` and `responseHeaders` — exactly
what is needed to detect rate limits and read `retry-after`.

## Important constraint: opencode's own retry

opencode already retries on the SAME key with backoff derived from
`retry-after` (`packages/opencode/src/session/retry.ts`). A plugin cannot
override that retry-scheduling. What the plugin can do:

1. Receive the failure via `session.error`.
2. Move the offending key to quarantine.
3. Ensure the NEXT attempt's `chat.headers` invocation picks a different
   key.

This means opencode's same-key retry may fire once or twice before the
plugin's quarantine-on-next-call takes effect. That is acceptable for v1
because opencode's own retry will either succeed (transient 5xx) or surface
another `session.error` that the plugin will then react to.

## Module layout

```
src/
  config.ts      env + options → ProviderConfig
  state.ts       KeyPool: round-robin + weight + quarantine
  classify.ts    raw error → { action, retryAfterMs, reason }
  index.ts       plugin factory wiring hooks
  *.test.ts      table-driven tests
```

Pure logic (`config`, `state`, `classify`) has no opencode imports and is
fully unit-testable. `index.ts` is the only file that depends on
`@opencode-ai/plugin`.
