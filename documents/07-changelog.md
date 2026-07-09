# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.3] - 2026-07-08

### Fixed
- **Model search display name**: Fixed broken model search for providers with multi-word IDs (e.g. `cloudflare-workers-ai`). The model picker now uses the display name ("Cloudflare Workers AI") instead of the raw slug for search.
- **Keychain dashboard speed**: Reduced model-selection keystroke delays from 80/160/260ms to 0/5/10ms. Initial dashboard load now prefers in-memory `api.state.provider` synchronously over network `provider.list` calls, making `/keychain` open instantly.

## [2.0.2] - 2026-07-08

### Fixed
- **Changelog formatting:** Fixed markdown rendering issues in the changelog file.

## [2.0.1] - 2026-07-08

### Fixed
- **Quarantine retry-after duration:** The plugin now correctly uses the `retry-after` header value (when provided by the API or parsed from the error body) as the exact quarantine duration, instead of overriding it with the default mathematical backoff. (Thanks to @fengjikui)
- **Fallback disabled key filter:** Fixed a critical bug where permanently disabled keys (401/403 Unauthorized) were incorrectly re-activated during the desperate no-active-keys fallback loop. Now, only quarantined keys are allowed to recover. (Thanks to @fengjikui)
- **Typings:** Improved Bun global fetch parameter typings and `envMap` extraction. (Thanks to @fengjikui)

## [2.0.0] - 2026-07-08

### Added
- **Global fetch monkey-patching**: Moved away from `chat.headers` and `session.error` hooks. The plugin now intercepts `globalThis.fetch` to ensure key rotation covers all OpenCode operations (background tasks, title generation, autocomplete, etc.) with instant, silent retry.
- **Overload action (2s backoff)**: For generic `503 Service Unavailable` or `ResourceExhausted` errors, the plugin applies a short 2-second backoff rather than the full 60-second exponential tier.
- **Body duration parsing**: The plugin intelligently parses text like `Quota resets in 4h 26m` or `resets in 45s` directly from error response bodies.
- **`keychain-reset` tool**: A new tool to instantly reset all quarantined keys back to active.
- **TUI Model switcher**: The `/keychain` dashboard now allows directly selecting and switching active models via `switchModel()` RPC.
- **Provider Aliases**: Added `nim` alias for `nvidia`, and `cf`/`cloudflare` alias for `cloudflare-workers-ai`.
- **Cloudflare Workers AI support**: The plugin understands Account IDs passed as `meta.account_id` and correctly injects them into endpoint URLs during fetch interception.

### Changed
- **Quarantine state resets**: Keys that successfully complete a request after being quarantined now reset their `consecutiveErrors` count to `0`.
- **Match keys safely**: `fetch-patch.ts` uses strict token validation to prevent false positives when checking if an existing `Authorization` header contains a key.
- **No manual auth patching required**: The fetch hook prevents native keys from leaking without needing aggressive `auth.json` backups, though backup logic remains.

### Fixed
- **Rate-limit detection on opencode native usage**: The plugin no longer mistakenly quarantines your fallback failover keys if the primary native OpenCode request throws an internal rate limit error.
- **Export crashes**: Fixed a fatal `readAuth is not a function` error during plugin init on deployed builds.

## [1.0.0] - 2026-07-06

### Added

- **TUI dashboard**: `/keychain` slash command (aliases: `/failover`, `/opencode-failover`) opens a DialogAlert showing provider key status, counts, and native key backup state.
- **Slash commands**: `/keychain`, `/failover`, `/opencode-failover` all dispatch the same dashboard.
- **Shared state**: `~/.config/opencode/failover-state.json` with masked keys, file permissions `0600`.
- **Version checker**: Polls npm registry every 5 minutes. Shows toast notification on new version.
- **Auto-register TUI**: `config` hook writes `~/.config/opencode/tui.json` with plugin ID.
- **Dual package**: `exports["./server"]` + `exports["./tui"]` for server-only and TUI-only load paths.

### Changed

- **Package exports**: `"."` -> `"./server"` + `"./tui"` with config blocks.
- **State serialization**: `KeyPool.register()`/`quarantine()`/`disable()` now call `serialize()` to write shared state.

### Fixed

- **TUI import**: Removed `solid-js` direct import.

## [0.2.0] - 2026-07-05

### Added

- **Native API key backup/restore**: When keychain keys exist for a provider, the plugin reads opencode's `auth.json`, backs up the native API key (in-memory), and removes it.
- **Auth utils**: `src/lib/auth.ts` with graceful handling of missing/corrupt `auth.json`.
- **Auth tests**: 12 tests for auth.json operations.

### Fixed

- **Event hook**: Replaced with `lastUsed` Map that tracks session/provider/key from `chat.headers`.
- **Key rotation**: Plugin's `chat.headers` key was overwritten by opencode's native key from `auth.json`.
- **Remove-all pool sync**: `keychain-remove` path now calls `pool.register()`.
- **Provider discovery**: Added `discoverEnvProviders()`.

## [0.1.0] - 2026-07-04

### Added

- **`keychain-setup` tool**: Interactive key setup via natural language.
- **`keychain-remove` tool**: Remove all or specific keys for a provider.
- **`.env` file support**: Plugin reads `{PROVIDER}_API_KEYS=...` from `.env`.
- **Key rotation**: Slot-based weighted round-robin across multiple API keys.
- **Quarantine system**: Exponential backoff (60s -> 120s -> 240s -> 300s cap).
- **Error classification**: Detects rate-limit (429), auth failures (401/402/403), server errors (5xx), and provider-specific patterns.
- **Key disable**: Permanently disables keys on auth/billing failures.
- **`chat.headers` hook**: Injects `Authorization: Bearer <key>`.
- **`session.error` event subscriber**: Classifies errors and mutates key pool state.
- **`keychain-status` tool**: LLM-callable tool showing live key state.
- **Configuration**: Three config sources with precedence.
- **Debug mode**: `OPENCODE_FAILOVER_DEBUG=1`.
- **Provider support**: Works with any OpenAI-compatible provider.
- **Tests**: 28 table-driven tests.
- **CI/CD**: GitHub Actions workflow.

### Dependencies

- `@opencode-ai/plugin` ^1.0.0
- `zod` ^3.0.0
- Runtime: Bun >=1.0.0
