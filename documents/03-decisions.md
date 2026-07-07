# ADR 03 — Locked decisions

## Naming

- Repo / npm package: `opencode-failover`.
- npm-available as of 2026-07-04.
- Chosen for clarity over alternatives `opencode-keyrot`, `opencode-polykey`, `opencode-provider-router`.

## Scope

- Generic across providers (not nvidia-specific).
- Supports any OpenCode-compatible provider that reads an `Authorization` or `x-api-key` header.

## Config

Three sources, merged in this precedence:

1. `OPENCODE_FAILOVER_PROVIDERS` env (JSON map of provider configs).
2. `OPENCODE_FAILOVER_KEYS` env (JSON map of string array keys per provider).
3. `<ID>_API_KEYS` env (comma list per provider), merged with options.
4. `opencode.json` plugin options.

`header` defaults to `Authorization`; `scheme` defaults to `Bearer`.

## Rotation algorithm

Slot-based weighted round-robin. Each active key is repeated `weight` times in a flat slots array; a monotonic cursor picks the next slot modulo array length. Default weight is 1.

## Failover triggers

| Signal | Action |
|---|---|
| 429 + rate-limit patterns | quarantine |
| 5xx | quarantine |
| ResourceExhausted / quota | overload (2s quarantine) |
| 401 / 402 / 403 | disable |

## Alternatives considered

### `chat.headers` hook vs `global fetch patch`

**Option A: `chat.headers` hook** — inject Authorization header via OpenCode plugin hook before each chat request.
*(This was the v1 approach).*

| Pros | Cons |
|---|---|
| Native plugin API | Doesn't intercept background requests (title generation, autocomplete) |
| Safe | Requires waiting for `session.error` to catch failures, which is slow |

**Option B: `global fetch patch` (chosen for v2)** — monkey-patch `globalThis.fetch` to intercept all outbound HTTP requests made by OpenCode.

| Pros | Cons |
|---|---|
| Intercepts 100% of network traffic (autocomplete, titles, embeddings) | Invasive (modifies Node global) |
| Can read raw HTTP response status/headers immediately | Need to parse JWTs / existing headers to map to the correct provider |
| Bypasses OpenCode's retry layer, allowing instant silent failovers | |

**Decision**: `global fetch patch` for v2. The requirement to support background requests like title-generation safely without blowing up the user's primary chat session necessitated intercepting traffic at the absolute lowest level.

### Disabling vs permanent removal

**Option A: Remove disabled keys from pool** — they vanish from rotation entirely.

| Pros | Cons |
|---|---|
| Cleaner pool state | Cannot inspect removed keys |

**Option B: Mark as disabled (chosen)** — keys stay in pool with `status: "disabled"`, visible via `/keychain` and `keychain-status`.

| Pros | Cons |
|---|---|
| Operator can see disabled keys | Slightly more memory |
| Debugging is easier | Pool grows over time |

**Decision**: Mark as disabled. The visibility benefit outweighs the negligible memory cost.
