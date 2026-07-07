# ADR 02 — Quarantine backoff strategy

## Context

When an API key is rate-limited (`429`), we quarantine it to prevent further requests. We need a strategy to determine how long to quarantine the key.

## Decision

The quarantine duration is determined by:
1. Provider `retry-after` header / parsed body duration (if present)
2. Exponential backoff (if `retry-after` is missing)
3. Overload short-backoff (if it was classified as an Overload rather than strict rate limit)

### Overload backoff

If the classifier detects `ResourceExhausted`, `quota` or similar server-overload patterns, we apply a flat **2000ms (2 seconds)** backoff. This prevents penalizing a key heavily for transient cloud/networking load, while still rotating to the next key to avoid blocking the user.

### Exponential backoff schedule

If `retry-after` is not provided and it's a standard rate-limit, we apply exponential backoff based on `consecutiveErrors`:

| `consecutiveErrors` | Duration | Reason |
|-------------------|----------|--------|
| 1                 | 60s      | Standard tier-1 backoff |
| 2                 | 120s     | Tier-2 |
| 3                 | 240s     | Tier-3 |
| 4+                | 300s     | Max cap (5 minutes) |

### Resetting consecutive errors

When a key successfully completes a request after being quarantined, its `consecutiveErrors` counter is immediately reset to `0`. This ensures that a single rate-limit hit later in the day doesn't immediately jump to a 5-minute timeout.

(Earlier iterations preserved `consecutiveErrors` until a manual reset, but this proved too aggressive for providers with strict per-minute but loose per-day limits).

## Rationale

- **Respecting headers**: Providers know their limits best. If they say "wait 10 seconds", we wait 10 seconds.
- **Short overload backoff**: 5xx/ResourceExhausted errors are often resolved within seconds; a 60s quarantine is too punitive.
- **Resetting on success**: This ensures keys don't get permanently stuck in high-backoff states during normal usage patterns where rate-limits are hit occasionally but recover quickly.
