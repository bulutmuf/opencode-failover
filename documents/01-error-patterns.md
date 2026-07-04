# ADR 01 — Error classification patterns

## Context

opencode surfaces `SessionV1.APIError` via the `session.error` event. The
shape includes `statusCode`, `responseHeaders`, `responseBody`, `message`,
and `isRetryable`. We must classify each error into one of three actions:

- **Rotate** — the key is temporarily bad; quarantine it and use another.
- **Disable** — the key is permanently bad; remove it from rotation.
- **Ignore** — not our concern; let opencode handle it.

## Decision

| Signal | Action |
|---|---|
| 429 | Rotate |
| 402 (payment required) | Rotate |
| 401 | Disable |
| 403 | Disable |
| 5xx | Rotate |
| `isRetryable: true` on any 4xx | Rotate |
| Body contains `overloaded`, `capacity`, `quota` | Rotate |
| Body contains `rate limit`, `too many requests`, `exhausted`, `unavailable`, `rate increased too quickly` | Rotate |
| Anthropic JSON `{ type: "error", error: { type: "too_many_requests" } }` | Rotate |
| OpenAI JSON `{ error: { code: "rate_limit..." } }` | Rotate |
| Other 4xx (400, 404) | Ignore |

## retry-after parsing

When `Rotate` is chosen, retry-after is parsed in this order:

1. `retry-after-ms` header (milliseconds, preferred).
2. `retry-after` header as seconds (numeric).
3. `retry-after` header as HTTP-date.

If none are present, the quarantine duration falls back to the exponential
backoff strategy in ADR 02.

## Source of patterns

Patterns are mirrored from opencode's own `retryable()` classifier at
`packages/opencode/src/session/retry.ts:68-152` (dev branch v1.17.13). This
ensures the plugin agrees with opencode on what constitutes a rate-limit
class error.
