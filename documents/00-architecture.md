# Architecture Overview

`opencode-failover` rotates API keys to provide continuous LLM availability during rate limits. Because OpenCode internally manages API requests directly using undici/fetch, this plugin intercepts HTTP requests at the lowest level.

## High-Level Flow

```
┌──────────────┐   Global fetch   ┌────────────────────┐
│              ├── (monkey-patch)─▶      Plugin        │
│   OpenCode   │                  │  (fetch-patch.ts)  │
│              │◀─── Modified ────┼────────────────────┤
└──────┬───────┘   Request        │ - Pool lookup      │
       │                          │ - Header inject    │
     HTTP                         │ - Error classifier │
   Request                        └────────────────────┘
       ▼
┌──────────────┐
│ LLM Provider │
└──────────────┘
```

## Global Fetch Monkey-Patch

To reliably rotate API keys across *all* of OpenCode's activities (chat, autocomplete, background title generation, etc.), `opencode-failover` uses a global monkey-patch of `globalThis.fetch`. 

**Why patch `fetch`?**
OpenCode's internal router uses Node's standard `fetch` API. Earlier versions of this plugin attempted to use OpenCode's plugin event hooks (`chat.headers` / `session.error`), but those hooks do not cover background tasks, title generation, or autocomplete requests, and the `session.error` event fires too late to silently retry an HTTP request.

### Request Interception (`fetch-patch.ts`)
1. Intercepts the outbound `fetch` call.
2. Reads the `Authorization` or `x-api-key` headers from the request.
3. Looks up the current active key in the failover pool by matching the existing request's token.
4. If a match is found, replaces the header with the *current active key* for that provider.
5. Awaits the true `fetch` response.
6. If the response indicates failure (429, 5xx, etc.), passes the status code and body to `classify()`.
7. Mutates the `KeyPool` if the key needs to be quarantined or disabled.

## Module Layout

- **`index.ts`**
  Initializes the environment, registers tools (`keychain-setup`, `keychain-remove`, etc.), and loads the fetch patch.
- **`lib/fetch-patch.ts`**
  The `fetch` interceptor. Responsible for matching keys and invoking the classifier on responses.
- **`lib/auth.ts`**
  Handles backup and restoration of OpenCode's native keys in `~/.local/share/opencode/auth.json`.
- **`lib/config.ts`**
  Environment variables parser. Scans for `<PROVIDER>_API_KEYS` and processes the unified `OPENCODE_FAILOVER_PROVIDERS` JSON.
- **`lib/state.ts` (KeyPool)**
  The brain. Holds keys, weights, and quarantine timers. Exposes `next()`, `quarantine()`, and `status()`.
- **`lib/classify.ts`**
  Pure functions parsing HTTP status codes and response bodies (e.g. Anthropic/OpenAI specific JSON formats) into normalized `ErrorAction`s.
- **`lib/tui.tsx`**
  Interactive CLI dashboard (the `/keychain` slash command) displaying live key rotation statuses.

## Storage and Persistence

The `KeyPool` is primarily entirely in-memory, ensuring speed and zero-disk-IO overhead on the hot path. 
For UI consistency and debugging, `state.ts` writes a masked summary of keys (with weights and timers) to `~/.config/opencode/failover-state.json`.

Actual API keys supplied via LLM tools (`keychain-setup`) are appended securely to `~/.env` (or whatever `opencode env path` resolves to).
