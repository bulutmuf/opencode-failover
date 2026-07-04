# ADR 03 — Locked decisions

## Naming

- Repo / npm package: `opencode-failover`.
- npm-available as of 2026-07-04.
- Chosen for clarity over alternatives `opencode-keyrot`, `opencode-polykey`,
  `opencode-provider-router`.

## Scope

- Generic across providers (not nvidia-specific).
- v1 supports any OpenAI-compatible provider that reads an `Authorization`
  header.
- A `provider` hook (virtual provider registration) is deferred to v2.

## Config

Two sources, merged in this precedence:

1. `OPENCODE_FAILOVER_PROVIDERS` env (JSON map of provider configs).
2. `<ID>_API_KEYS` env (comma list per provider), merged with options.
3. `opencode.json` plugin options: `{ providers: { [id]: { keys, header?,
   scheme?, weight? } } }`.

`header` defaults to `Authorization`; `scheme` defaults to `Bearer`.

## Rotation algorithm

Slot-based weighted round-robin. Each active key is repeated `weight` times
in a flat slots array; a monotonic cursor picks the next slot modulo array
length. Default weight is 1. This replaced an earlier cursor-math approach
that always returned the first key.

## Failover triggers

| Signal | Action |
|---|---|
| 429 + rate-limit patterns | quarantine |
| 5xx | quarantine |
| 401 / 403 | disable |

## Distribution

- Single GitHub repo, private now, public later.
- `documents/` holds ADRs and architecture notes.
- GitHub Wiki will hold deep usage docs (separate task).
- README is a separate task and explicitly excluded from this work.
- npm-published via CI on `v*` tags.
