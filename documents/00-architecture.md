# 00 — Architecture

## Goal

Rotate API keys across multiple keys for the same opencode provider so that
rate-limited or auth-failing keys are skipped and the next healthy key is
used on the following request.

## Request flow

```
User sends message
        │
        ▼
┌───────────────────┐
│  opencode runtime │
│  (AI SDK / native)│
└────────┬──────────┘
         │
         │  1. chat.headers hook fires
         ▼
┌───────────────────┐     ┌──────────────────┐
│ opencode-failover │────▶│ KeyPool.pick()   │
│   plugin          │     │  → active key    │
│                   │     │  → slot-based    │
│                   │     │    round-robin   │
└────────┬──────────┘     └──────────────────┘
         │
         │  2. Authorization header injected
         ▼
┌───────────────────┐
│  LLM provider API │  (NVIDIA, OpenRouter, Anthropic, etc.)
└────────┬──────────┘
         │
    ┌────┴────┐
    │ success │ error
    └────┬────┘
         │         │
         ▼         ▼
      response   ┌──────────────────┐
                 │ session.error    │
                 │ event fires      │
                 └────────┬─────────┘
                          │
                          │  3. classify(error)
                          ▼
                 ┌──────────────────┐
                 │ Rotate? → quarantine key
                 │ Disable? → remove key
                 │ Ignore? → no-op
                 └──────────────────┘
                          │
                          ▼
                 Next request → different key
```

## Error flow (detailed)

```
session.error event
        │
        ▼
┌───────────────────┐
│ classify(raw)     │
│                   │
│ 429? ──────────▶ Rotate  ──▶ pool.quarantine(key, retryAfter?)
│ 401/402/403? ──▶ Disable ──▶ pool.disable(key)
│ 5xx? ──────────▶ Rotate  ──▶ pool.quarantine(key, null)
│ rate pattern? ──▶ Rotate  ──▶ pool.quarantine(key, retryAfter?)
│ other? ────────▶ Ignore  ──▶ (no-op)
└───────────────────┘
        │
        ▼ (Rotate path)
┌───────────────────┐
│ quarantine()      │
│                   │
│ consecutiveErrors++│
│ duration = 60s × 2^(n-1) │
│ capped at 300s    │
│ retry-after? use it│
└───────────────────┘
        │
        ▼
Next chat.headers call → pool.pick() skips quarantined keys
```

## Module dependency graph

```
index.ts  ──imports──▶  config.ts   (validateProviderConfig, providerIDs)
    │                       ▲
    ├──imports──▶  state.ts  │  (KeyPool)
    │                       │
    └──imports──▶  classify.ts
                   (classify, ErrorAction)

Pure modules (no @opencode-ai/plugin dependency):
  config.ts    env + options → ProviderConfig
  state.ts     KeyPool: round-robin + weight + quarantine
  classify.ts  raw error → { action, retryAfterMs, reason }

Only plugin-dependent module:
  index.ts     plugin factory wiring hooks
```

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
- **`tool`** — a single tool `keychain-status` is registered so the LLM and
  the TUI slash command surface can inspect live key state.

## Why not the `provider` hook

The `provider` hook registers a virtual provider ID and optionally lists
models. It couples the plugin to AI SDK delegation and requires model
catalogue maintenance. `chat.headers` works with any existing provider
configuration — the plugin only rotates keys, it does not own the request
pipeline. A `provider` hook may be added in v2 for richer control (virtual
provider registration, model filtering).

## Why not `tool.execute.after`

`tool.execute.after` only covers tool calls (bash, file edits, etc.), not
the message-step LLM call that most providers rate-limit. `session.error`
is the only event that carries the full `Assistant.fields.error` payload,
which includes `statusCode` and `responseHeaders` — exactly what is needed
to detect rate limits and read `retry-after`.

## Why `session.error` and not `chat.message`

`chat.message` fires when a user sends a message, before the LLM call.
It cannot detect errors that happen during or after the request.
`session.error` fires after the LLM call fails, carrying the full error
payload. It is the correct detection point.

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
