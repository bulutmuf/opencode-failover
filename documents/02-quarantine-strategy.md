# ADR 02 — Quarantine strategy

## Context

When a key is rate-limited, opencode's own retry fires in-place on the same
key. We need the plugin's pool to skip that key on subsequent requests until
it is safe to use again. The reset time is frequently unknown (no
`retry-after` header on many providers), so a fixed wait is insufficient.

## Key state machine

```
                    ┌──────────────┐
                    │              │
         ┌────────▶│    ACTIVE    │◀────────┐
         │         │              │         │
         │         └──────┬───────┘         │
         │                │                 │
         │   pick()       │ 429/5xx         │ quarantine
         │   returns      │ error           │ timer expires
         │   this key     │                 │
         │                ▼                 │
         │         ┌──────────────┐         │
         │         │              │─────────┘
         │         │ QUARANTINED  │
         │         │              │
         │         └──────┬───────┘
         │                │
         │   401/403      │ 429/5xx
         │   error        │ again
         │                │
         │                ▼
         │         ┌──────────────┐
         │         │              │
         └─────────│  DISABLED    │
                   │  (permanent) │
                   └──────────────┘
```

## Decision

Exponential backoff with a cap:

```
quarantineMs = min(BASE * 2^(consecutiveErrors - 1), CAP)
BASE = 60_000
CAP  = 300_000
```

| Consecutive error | Quarantine |
|---|---|
| 1 | 60s |
| 2 | 120s |
| 3 | 240s |
| 4+ | 300s (capped) |

When a `retry-after` header is present, the parsed value overrides the
exponential schedule for that quarantine event.

## Recovery scenario

Three keys: A, B, C. All active.

```
t=0s    Request → A (picked by round-robin)
t=0s    A returns 429 with retry-after: 90s
t=0s    A quarantined for 90s (retry-after overrides 60s base)
t=0s    B is next in rotation
t=5s    Request → B (picked by round-robin)
t=5s    B returns 500
t=5s    B quarantined for 60s (consecutiveErrors=1, no retry-after)
t=10s   Request → C (picked by round-robin)
t=10s   C succeeds → C stays active
t=65s   B's quarantine expires → B released to active (consecutiveErrors reset to 0)
t=95s   A's quarantine expires → A released to active (consecutiveErrors reset to 0)
t=100s  All three keys active again
```

## Retry-after override example

```
t=0s    Request → key-A
t=0s    429 response with retry-after-ms: 45000
t=0s    quarantine(key-A, 45000ms)  ← overrides 60s base
t=45s   key-A released, back to active
```

Without the retry-after override, the key would have been quarantined for
60s (too short if the provider needs 45s) or 120s (too long, wasting
capacity).

## When a quarantined key is released

It returns to the active rotation but `consecutiveErrors` is preserved. The
next failure on that key resumes the backoff from its previous level rather
than restarting at 60s. This penalises chronically bad keys without ever
permanently disabling them.

**Exception**: if the key was released because its timer expired (not because
it was force-released), `consecutiveErrors` resets to 0. This rewards keys
that recover naturally.

## All keys quarantined

If every key in a pool is quarantined, `pick()` releases the key with the
earliest `quarantinedUntil` (the soonest to recover) and returns it. This
prevents a hard failure when the entire pool is temporarily exhausted.

```
Keys: A (expires t=120), B (expires t=90), C (expires t=150)
All quarantined.

pick() → releases B (earliest), returns B's key.
B is now active with consecutiveErrors=0.
```

## Disable vs quarantine

- 429 / 5xx / overload patterns → quarantine (transient).
- 401 / 403 / 402 → permanent disable (auth/billing). Disabled keys never
  return to rotation; they are reported by `keychain-status` so an operator
  can investigate.

## Edge cases

| Scenario | Behavior |
|---|---|
| All keys disabled | `pick()` throws `Error("No keys configured")` — opencode surfaces the error |
| Single key quarantined | `pick()` releases it immediately (all-quarantined fallback) |
| Key quarantined twice rapidly | `consecutiveErrors` increments: 60s → 120s |
| retry-after = 0 or negative | Ignored, falls back to exponential schedule |
| Provider not in pool | `pick()` throws, caught by `chat.headers` hook |

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `QUARANTINE_BASE_MS` | 60,000 | Initial quarantine (1 minute) |
| `QUARANTINE_CAP_MS` | 300,000 | Maximum quarantine (5 minutes) |
| Backoff factor | 2× | Each error doubles the quarantine |
