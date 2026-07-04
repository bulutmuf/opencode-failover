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
| 401 / 402 / 403 | disable |

## Alternatives considered

### Provider hook vs chat.headers

**Option A: `provider` hook** — register a virtual provider ID, list models,
own the full request pipeline via AI SDK delegation.

| Pros | Cons |
|---|---|
| Full control over request lifecycle | Requires model catalogue maintenance |
| Can intercept responses directly | Couples plugin to AI SDK internals |
| Virtual provider name visible in TUI | More complex, harder to test |

**Option B: `chat.headers` hook (chosen)** — inject Authorization header
before each request; opencode owns the actual HTTP call.

| Pros | Cons |
|---|---|
| Works with any existing provider config | Cannot intercept responses |
| Minimal moving parts | Cannot override request body/URL |
| Easy to test (pure header injection) | opencode's same-key retry fires before quarantine |

**Decision**: `chat.headers` for v1. Lower complexity, works with any
provider, easier to test. `provider` hook may be added in v2 for richer
control.

### Round-robin vs weighted round-robin

**Option A: Simple round-robin** — each key gets equal share regardless of
assigned weight.

| Pros | Cons |
|---|---|
| Simplest implementation | Cannot prioritize faster/cheaper keys |
| No weight configuration needed | All keys treated equally |

**Option B: Weighted round-robin (chosen)** — each key gets `weight` slots
in the rotation array.

| Pros | Cons |
|---|---|
| Prioritize faster/cheaper keys | Slightly more complex |
| Natural fit for tiered API plans | Weight configuration required |

**Decision**: Weighted round-robin. The added complexity is minimal (a flat
array of repeated keys), and it enables natural tiering (e.g., prefer
cheaper keys over expensive ones).

### Fixed vs exponential quarantine

**Option A: Fixed quarantine (e.g., 60s)** — all quarantined keys wait the
same duration.

| Pros | Cons |
|---|---|
| Simplest | Doesn't adapt to repeated failures |
| Predictable | May wait too long or too short |

**Option B: Exponential backoff (chosen)** — 60s → 120s → 240s → 300s cap.

| Pros | Cons |
|---|---|
| Adapts to repeated failures | More state to track |
| Penalizes chronically bad keys | Backoff may overshoot provider reset |
| Cap prevents indefinite quarantine | Slightly more complex |

**Decision**: Exponential backoff with 300s cap. Adapts to failure patterns
while the cap prevents keys from being quarantined forever. `retry-after`
header overrides the schedule when present.

### Global state vs per-request state

**Option A: Per-request state** — each request independently decides which
key to use based on a snapshot.

| Pros | Cons |
|---|---|
| Stateless, no coordination | No memory of past failures |
| Simplest | Same bad key may be retried |

**Option B: Global KeyPool (chosen)** — in-memory pool persists across
requests, tracks quarantine state.

| Pros | Cons |
|---|---|
| Remembers past failures | State lost on plugin restart |
| Prevents retrying bad keys | Not shared across processes |
| Enables weighted rotation | More complex |

**Decision**: Global KeyPool. The plugin needs memory of past failures to
avoid retrying bad keys. State is lost on restart, which is acceptable
because provider reset times are typically short (< 5 minutes).

### Disabling vs permanent removal

**Option A: Remove disabled keys from pool** — they vanish from rotation
entirely.

| Pros | Cons |
|---|---|
| Cleaner pool state | Cannot inspect removed keys |
| Less memory | Operator cannot see what went wrong |

**Option B: Mark as disabled (chosen)** — keys stay in pool with
`status: "disabled"`, visible via `keychain.status`.

| Pros | Cons |
|---|---|
| Operator can see disabled keys | Slightly more memory |
| Debugging is easier | Pool grows over time |
| `keychain.status` shows full picture | Negligible for typical pool sizes |

**Decision**: Mark as disabled. The visibility benefit outweighs the
negligible memory cost for typical API key pools (2-10 keys).

## Distribution

- Single GitHub repo, private now, public later.
- `documents/` holds ADRs and architecture notes.
- GitHub Wiki will hold deep usage docs (separate task).
- README is a separate task and explicitly excluded from this work.
- npm-published via CI on `v*` tags.
