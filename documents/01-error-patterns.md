# ADR 01 — Error classification patterns

## Context

`opencode-failover` intercepts HTTP responses directly via the patched `fetch`. The
`classify()` function analyzes the status code, headers, and response body string
to return one of four actions: `Rotate`, `Disable`, `Overload`, or `Ignore`.

## Decision Table

| Signal | Action | Rationale |
|---|---|---|
| 429 | Rotate | Rate limited — key temporarily unusable |
| 401 | Disable | Auth failure — key is invalid or revoked |
| 402 | Disable | Payment required — billing/credits exhausted |
| 403 | Disable | Forbidden — key lacks permissions |
| 5xx | Rotate | Server error — transient, try another key |
| Body: `overloaded`, `capacity`, `quota`, `resourceexhausted` | Overload | Provider overloaded (applies 2s short backoff) |
| Body: `rate limit`, `too many requests` | Rotate | Generic rate-limit text patterns |
| Body: `exhausted`, `unavailable` | Overload | Provider capacity exhausted |
| Body: `rate increased too quickly` | Rotate | Provider throttle pattern |
| Anthropic JSON `{ type: "error", error: { type: "too_many_requests" } }` | Rotate | Anthropic-specific |
| OpenAI JSON `{ error: { code: "rate_limit..." } }` | Rotate | OpenAI-specific |
| Other 4xx (400, 404) | Ignore | Client error — not a key problem |

## Overload vs Rotate

Some APIs (like Google or Anthropic) occasionally return generic `503 Service Unavailable` or `ResourceExhausted` errors with a 429 status code when the provider itself is under load. We treat this as an `Overload` action, which applies a short (2-second) backoff rather than the standard 60-second backoff. This ensures we don't penalize keys for short-term network blips.

## Provider-specific error patterns

### NVIDIA NIM

NVIDIA returns `429` with body patterns:
```json
{ "error": { "code": "TOO_MANY_REQUESTS", "message": "Rate limit exceeded" } }
```
Also uses `retry-after` header. Plugin classifies via both status code and body pattern match.

### Anthropic

Anthropic returns structured JSON:
```json
{
  "type": "error",
  "error": {
    "type": "too_many_requests",
    "message": "Rate limited: too many requests"
  }
}
```
The `too_many_requests` type is matched by `hasRateLimitPattern()`. Also sends `retry-after-ms` header (milliseconds).

### OpenAI / OpenAI-compatible

OpenAI returns:
```json
{ "error": { "code": "rate_limit", "message": "Rate limit reached" } }
```

## retry-after parsing

When `Rotate` is chosen, retry-after is parsed in this order:

1. `retry-after-ms` header (milliseconds, preferred).
2. `retry-after` header as seconds (numeric).
3. `retry-after` header as HTTP-date.
4. Response body text matching `Quota resets in 4h 26m` or `resets in 45s`.

If none are present, the quarantine duration falls back to the exponential
backoff strategy in ADR 02.

## Test coverage

| Pattern | Test case |
|---|---|
| 429 + retry-after-ms | `classify.test.ts` — parsed to quarantine duration |
| ResourceExhausted | `classify.test.ts` — triggers Overload |
| 401 / 402 / 403 | `classify.test.ts` — triggers Disable |
| 502 / 503 | `classify.test.ts` — triggers Rotate |
| Message string duration | `classify.test.ts` — parses "in 4h 26m" into ms |
| Other 4xx | `classify.test.ts` — ignored |
