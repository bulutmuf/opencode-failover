# ADR 01 — Error classification patterns

## Context

opencode surfaces `SessionV1.APIError` via the `session.error` event. The
shape includes `statusCode`, `responseHeaders`, `responseBody`, `message`,
and `isRetryable`. We must classify each error into one of three actions:

- **Rotate** — the key is temporarily bad; quarantine it and use another.
- **Disable** — the key is permanently bad; remove it from rotation.
- **Ignore** — not our concern; let opencode handle it.

## Decision

| Signal | Action | Rationale |
|---|---|---|
| 429 | Rotate | Rate limited — key temporarily unusable |
| 401 | Disable | Auth failure — key is invalid or revoked |
| 402 | Disable | Payment required — billing/credits exhausted |
| 403 | Disable | Forbidden — key lacks permissions |
| 5xx | Rotate | Server error — transient, try another key |
| `isRetryable: true` on any 4xx | Rotate | Provider marks it retryable |
| Body: `overloaded`, `capacity`, `quota` | Rotate | Provider overloaded (may not be 429) |
| Body: `rate limit`, `too many requests` | Rotate | Generic rate-limit text patterns |
| Body: `exhausted`, `unavailable` | Rotate | Provider capacity exhausted |
| Body: `rate increased too quickly` | Rotate | Provider throttle pattern |
| Anthropic JSON `{ type: "error", error: { type: "too_many_requests" } }` | Rotate | Anthropic-specific |
| OpenAI JSON `{ error: { code: "rate_limit..." } }` | Rotate | OpenAI-specific |
| Other 4xx (400, 404) | Ignore | Client error — not a key problem |

## Provider-specific error patterns

### NVIDIA NIM

NVIDIA returns `429` with body patterns:
```json
{ "error": { "code": "TOO_MANY_REQUESTS", "message": "Rate limit exceeded" } }
```
Also uses `retry-after` header. Plugin classifies via both status code and
body pattern match.

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
The `too_many_requests` type is matched by `hasRateLimitPattern()`. Also
sends `retry-after-ms` header (milliseconds).

### OpenAI / OpenAI-compatible

OpenAI returns:
```json
{ "error": { "code": "rate_limit", "message": "Rate limit reached" } }
```
Also sends `x-ratelimit-reset-requests` and `x-ratelimit-reset-tokens`
headers (not parsed by plugin — use exponential backoff).

### OpenRouter

OpenRouter returns `429` with standard `retry-after` header. Body may
contain:
```json
{ "error": { "code": "429", "message": "Rate limit exceeded" } }
```

### Custom / self-hosted

Any provider returning `429` or 5xx triggers rotation. Body patterns
matching `rate limit`, `too many requests`, `exhausted`, `unavailable`
are caught by the generic matcher.

## retry-after parsing

When `Rotate` is chosen, retry-after is parsed in this order:

1. `retry-after-ms` header (milliseconds, preferred).
2. `retry-after` header as seconds (numeric).
3. `retry-after` header as HTTP-date.

If none are present, the quarantine duration falls back to the exponential
backoff strategy in ADR 02.

## Test coverage

| Pattern | Test case |
|---|---|
| 429 + retry-after-ms | `classify.test.ts` — parsed to quarantine duration |
| 429 overloaded | `classify.test.ts` — body match triggers rotate |
| 401 | `classify.test.ts` — disable |
| 403 | `classify.test.ts` — disable |
| 402 | `classify.test.ts` — disable (billing) |
| 502 | `classify.test.ts` — rotate |
| 503 isRetryable | `classify.test.ts` — rotate |
| Anthropic too_many_requests | `classify.test.ts` — JSON parse |
| OpenAI rate_limit code | `classify.test.ts` — JSON parse |
| retry-after seconds | `classify.test.ts` — converted to ms |
| retry-after HTTP-date | `classify.test.ts` — date arithmetic |
| Message-string rate-limit | `classify.test.ts` — text match |
| 400 | `classify.test.ts` — ignore |
| 404 | `classify.test.ts` — ignore |

## Source of patterns

Patterns are mirrored from opencode's own `retryable()` classifier at
`packages/opencode/src/session/retry.ts:68-152` (dev branch v1.17.13). This
ensures the plugin agrees with opencode on what constitutes a rate-limit
class error.
