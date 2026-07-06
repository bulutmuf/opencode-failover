# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-07-06

### Added

- **TUI dashboard**: `/keychain` slash command (aliases: `/failover`, `/opencode-failover`) opens a DialogAlert showing provider key status, counts, and native key backup state. No solid-js dependency — pure DialogAlert.
- **Slash commands**: `/keychain`, `/failover`, `/opencode-failover` all dispatch the same dashboard.
- **Shared state**: `~/.config/opencode/failover-state.json` with masked keys (e.g., `nvapi-...x4f2`), file permissions `0600`. Server plugin writes on every pool change; TUI plugin reads.
- **Version checker**: Polls `https://registry.npmjs.org/opencode-failover/latest` every 5 minutes. Shows toast notification on new version.
- **Auto-register TUI**: `config` hook writes `~/.config/opencode/tui.json` with plugin ID (backs up to `.bak` first). Single `opencode plugin opencode-failover` command sets up both server and TUI.
- **Dual package**: `exports["./server"]` + `exports["./tui"]` for server-only and TUI-only load paths.

### Changed

- **Package exports**: `"."` → `"./server"` + `"./tui"` with config blocks.
- **State serialization**: `KeyPool.register()`/`quarantine()`/`disable()` now call `serialize()` to write shared state.

### Fixed

- **TUI import**: Removed `solid-js` direct import — TUI plugin uses pure DialogAlert.

## [0.2.0] — 2026-07-05

### Added

- **Native API key backup/restore**: When keychain keys exist for a provider, the plugin reads opencode's `auth.json`, backs up the native API key (in-memory), and removes it. On `keychain-remove` (all keys), the native key is restored. Survives restart via `config` hook re-scan.
- **Auth utils**: `src/auth.ts` — `readAuth()`, `getNativeAuth()`, `removeNativeAuth()`, `restoreNativeAuth()` with graceful handling of missing/corrupt `auth.json`.
- **Auth tests**: 12 tests for auth.json operations (read, write, backup, restore, cycle, edge cases).

### Fixed

- **Event hook**: `containsAuthError()` never matched (no API key in error responses). Replaced with `lastUsed` Map that tracks session→provider/key from `chat.headers`.
- **Key rotation**: Plugin's `chat.headers` key was overwritten by opencode's native key from `auth.json`. Solved by native key removal.
- **Remove-all pool sync**: `keychain-remove` (all keys) path now calls `pool.register()` to update in-memory state.
- **Provider discovery**: `providerIDs()` didn't scan `<ID>_API_KEYS` env vars. Added `discoverEnvProviders()`.

## [0.1.0] — 2026-07-04

### Added

- **`keychain-setup` tool**: Interactive key setup via natural language (e.g., "Add these API keys for nvidia: key1, key2"). Writes to `.env` file automatically.
- **`keychain-remove` tool**: Remove all or specific keys for a provider via natural language (e.g., "Remove all NVIDIA API keys" or "Remove nvapi-key1 from NVIDIA").
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
  Disabled keys are reported via `keychain-status` but never reused.

- **`chat.headers` hook**: Injects `Authorization: Bearer <key>` (configurable
  header/scheme) before each LLM request.

- **`session.error` event subscriber**: Classifies errors and mutates key pool
  state in real time.

- **`keychain-status` tool**: LLM-callable tool showing live key state:
  active/quarantined/disabled counts, masked key identifiers, quarantine
  timers, last error messages.

- **Configuration**: Three config sources with precedence:
  1. `OPENCODE_FAILOVER_PROVIDERS` env (JSON map)
  2. `<ID>_API_KEYS` env (comma list) — auto-discovered at startup
  3. `opencode.json` plugin options (merged with env keys)

- **Debug mode**: `OPENCODE_FAILOVER_DEBUG=1` logs key injection and
  quarantine decisions via opencode's internal logging.

- **Provider support**: Works with any OpenAI-compatible provider (NVIDIA NIM,
  OpenRouter, Anthropic, OpenAI, custom/self-hosted).

- **Tests**: 28 table-driven tests covering rotation, quarantine, error
  classification, config discovery, and edge cases.

- **CI/CD**: GitHub Actions workflow for `bun test` + `bun run typecheck` on
  push/PR, npm publish on `v*` tags.

### Known limitations

- opencode retries on the same key before the plugin's quarantine takes
  effect (opencode's own retry fires in-place). The plugin changes the key
  for the NEXT request, not the current retry cycle.

- Keys added/removed via `keychain-setup`/`keychain-remove` take effect
  immediately in the current session. No restart needed.

- No `provider` hook in v1 — the plugin rotates keys on existing providers
  via `chat.headers`, it does not register virtual providers. Provider hook
  is planned for v0.3.0.

### Dependencies

- `@opencode-ai/plugin` ^1.0.0
- `zod` ^3.0.0
- Runtime: Bun >=1.0.0
