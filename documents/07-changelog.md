# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-04

### Added

- **`keychain.setup` tool**: Interactive key setup via `/keychain.setup provider=<id> keys=<comma-separated>`. Writes to `.env` file automatically.
- **`keychain.remove` tool**: Remove keys for a provider via `/keychain.remove provider=<id>`.
- **`.env` file support**: Plugin reads `{PROVIDER}_API_KEYS=...` from `.env` at startup. Custom path via `OPENCODE_FAILOVER_ENV_FILE`.
- **Startup key detection**: Toast notification warns if any configured provider has no keys.
- **Key rotation**: Slot-based weighted round-robin across multiple API keys
  per provider. Keys with higher weight get proportionally more requests.

- **Quarantine system**: Exponential backoff (60s → 120s → 240s → 300s cap)
  for rate-limited keys. Respects `retry-after` and `retry-after-ms` headers
  when present.

- **Error classification**: Detects rate-limit (429), auth failures (401/402/403),
  server errors (5xx), and provider-specific patterns (Anthropic
  `too_many_requests`, OpenAI `rate_limit`, generic "exhausted"/"unavailable").

- **Key disable**: Permanently disables keys on auth/billing failures (401/402/403).
  Disabled keys are reported via `keychain.status` but never reused.

- **`chat.headers` hook**: Injects `Authorization: Bearer <key>` (configurable
  header/scheme) before each LLM request.

- **`session.error` event subscriber**: Classifies errors and mutates key pool
  state in real time.

- **`keychain.status` tool**: LLM-callable tool showing live key state:
  active/quarantined/disabled counts, masked key identifiers, quarantine
  timers, last error messages.

- **Configuration**: Three config sources with precedence:
  1. `OPENCODE_FAILOVER_PROVIDERS` env (JSON map)
  2. `<ID>_API_KEYS` env (comma list) + options merge
  3. `opencode.json` plugin options

- **Debug mode**: `OPENCODE_FAILOVER_DEBUG=1` logs key injection and
  quarantine decisions via opencode's internal logging.

- **Provider support**: Works with any OpenAI-compatible provider (NVIDIA NIM,
  OpenRouter, Anthropic, OpenAI, custom/self-hosted).

- **Tests**: 21 table-driven tests covering rotation, quarantine, error
  classification, and edge cases.

- **CI/CD**: GitHub Actions workflow for `bun test` + `bun run typecheck` on
  push/PR, npm publish on `v*` tags.

### Known limitations

- opencode retries on the same key before the plugin's quarantine takes
  effect (opencode's own retry fires in-place). The plugin changes the key
  for the NEXT request, not the current retry cycle.

- Keys are cached at startup. Hot-reload requires opencode restart.
  `keychain.reload` tool is planned for v0.2.0.

- No `provider` hook in v1 — the plugin rotates keys on existing providers
  via `chat.headers`, it does not register virtual providers. Provider hook
  is planned for v0.3.0.

### Dependencies

- `@opencode-ai/plugin` ^1.0.0
- `zod` ^3.0.0
- Runtime: Bun >=1.0.0
