# ADR 02 — Quarantine strategy

## Context

When a key is rate-limited, opencode's own retry fires in-place on the same
key. We need the plugin's pool to skip that key on subsequent requests until
it is safe to use again. The reset time is frequently unknown (no
`retry-after` header on many providers), so a fixed wait is insufficient.

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

When a quarantined key is released (its timer expires), it returns to the
active rotation but `consecutiveErrors` is preserved. The next failure on
that key resumes the backoff from its previous level rather than restarting
at 60s. This penalises chronically bad keys without ever permanently
disabling them.

## All keys quarantined

If every key in a pool is quarantined, `pick()` releases the key with the
earliest `quarantinedUntil` (the soonest to recover) and returns it. This
prevents a hard failure when the entire pool is temporarily exhausted.

## Disable vs quarantine

- 429 / 5xx / overload patterns → quarantine (transient).
- 401 / 403 → permanent disable (auth). Disabled keys never return to
  rotation; they are reported by `keychain.status` so an operator can
  investigate.
