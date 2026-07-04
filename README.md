<p align="center">
  <h1 align="center">opencode-failover</h1>
</p>

<p align="center">
  API-key failover router plugin for OpenCode.<br/>
  Rotate across multiple provider keys. Automatically quarantine on rate-limit, disable on auth failure.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-failover"><img src="https://img.shields.io/npm/v/opencode-failover?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://github.com/bulutmuf/opencode-failover/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bulutmuf/opencode-failover?style=flat-square" alt="License"></a>
  <a href="https://github.com/bulutmuf/opencode-failover/actions"><img src="https://img.shields.io/github/actions/workflow/status/bulutmuf/opencode-failover/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/OpenCode-plugin-FF6B35?style=flat-square" alt="OpenCode Plugin">
  <img src="https://img.shields.io/badge/Bun-runtime-FBF0DF?style=flat-square&logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/Test-21%2F21-4CAF50?style=flat-square" alt="Tests">
</p>

---

<details>
<summary><strong>Table of Contents</strong></summary>

- [Quick Start](#quick-start)
- [Why This Works](#why-this-works)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Commands](#commands)
- [Supported Providers](#supported-providers)
- [Development](#development)
- [Architecture](#architecture)
- [License](#license)

</details>

## Quick Start

```bash
opencode plugin opencode-failover
```

Set your API keys:

```bash
export NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy,nvapi-zzz"
```

Restart OpenCode. The plugin activates automatically and begins rotating keys.

## Why This Works

Most LLM providers enforce per-key rate limits. When you hit the limit, requests fail and you are stuck waiting.

opencode-failover solves this by:

- **Rotating** to the next available key on rate-limit (429)
- **Quarantining** exhausted keys with exponential backoff (60s to 300s)
- **Disabling** permanently on auth failure (401/403)
- **Recovering** quarantined keys automatically when their timer expires

One provider, multiple keys, zero downtime.

## Features

- Weighted round-robin key rotation
- Exponential backoff quarantine (60s, 120s, 240s, 300s cap)
- `retry-after` header respect (milliseconds, seconds, HTTP-date formats)
- Permanent disable on auth errors (401/403) and billing errors (402)
- Temporary quarantine on server errors (5xx)
- Rate-limit pattern detection (Anthropic, OpenAI, and generic patterns)
- `/keychain.status` command for real-time key monitoring
- Debug logging via `OPENCODE_FAILOVER_DEBUG=1`
- Works with any OpenCode-compatible provider

## Installation

### Option 1: OpenCode CLI (recommended)

```bash
opencode plugin opencode-failover
```

This installs the package and updates your `opencode.json` automatically.

### Option 2: npm

```bash
npm install opencode-failover
```

Then add to your `opencode.json`:

```json
{
  "plugin": ["opencode-failover"]
}
```

### Option 3: Local development

```bash
git clone https://github.com/bulutmuf/opencode-failover.git
cd opencode-failover
bun install
```

Then symlink or copy `src/index.ts` to your OpenCode plugins directory:

```bash
cp src/index.ts ~/.config/opencode/plugins/failover.ts
```

## Configuration

### Environment variables

**Single provider** (comma-separated keys):

```bash
export NVIDIA_API_KEYS="nvapi-key1,nvapi-key2,nvapi-key3"
```

**Multiple providers** (JSON):

```bash
export OPENCODE_FAILOVER_PROVIDERS='{
  "nvidia": {
    "keys": ["nvapi-key1", "nvapi-key2", "nvapi-key3"],
    "scheme": "Bearer"
  },
  "openrouter": {
    "keys": ["sk-or-key1", "sk-or-key2"],
    "header": "Authorization"
  }
}'
```

### opencode.json options

```json
{
  "plugin": [
    ["opencode-failover", {
      "providers": {
        "nvidia": {
          "keys": ["nvapi-key1", "nvapi-key2", "nvapi-key3"],
          "scheme": "Bearer"
        },
        "openrouter": {
          "keys": ["sk-or-key1", "sk-or-key2"],
          "header": "Authorization"
        }
      }
    }]
  ]
}
```

### Config options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keys` | `string[]` | required | API keys for this provider |
| `header` | `string` | `"Authorization"` | HTTP header to inject |
| `scheme` | `string` | `"Bearer"` | Header value prefix |
| `weight` | `Record<string, number>` | `{}` | Per-key rotation weights |

### Precedence

1. `OPENCODE_FAILOVER_PROVIDERS` env (full JSON) overrides everything
2. `<PROVIDER>_API_KEYS` env + opencode.json options (merged)
3. opencode.json options only

## How It Works

```
Request    -->  Plugin picks next key (weighted round-robin)
             -->  Sets Authorization header
             -->  OpenCode makes LLM call
             -->  Success? Done.
             -->  Error?   session.error event fires
             -->  Plugin classifies error:
                    429 / rate-limit  -->  Quarantine key (exponential backoff)
                    401 / 403 / 402  -->  Disable key permanently
                    5xx              -->  Quarantine key temporarily
             -->  Next request picks a different key
             -->  Quarantined keys auto-release when timer expires
```

### Error classification

| Error | Action | Behavior |
|-------|--------|----------|
| 429 | Quarantine | Exponential backoff: 60s, 120s, 240s, 300s cap |
| 401 / 403 | Disable | Permanent, requires manual re-enable |
| 402 | Disable | Billing error, permanent |
| 5xx | Quarantine | Temporary, same backoff as 429 |
| Rate-limit pattern | Quarantine | Detected in body/message text |
| Other | Ignore | No action taken |

### Quarantine schedule

| Consecutive errors | Quarantine duration |
|-------------------|-------------------|
| 1 | 60 seconds |
| 2 | 120 seconds |
| 3 | 240 seconds |
| 4+ | 300 seconds (cap) |

If the provider returns a `retry-after` header, that value overrides the schedule.

## Commands

| Command | Description |
|---------|-------------|
| `/keychain.status` | Show all configured keys, their status, weights, and retry timers |

Example output:

```
## nvidia
  nvapi...abc [w=2] -- active
  nvapi...def -- QUARANTINED until 2026-07-04T12:35:00.000Z
  nvapi...ghi -- active
  [2 active, 1 quarantined, 0 disabled]
```

## Supported Providers

Works with any provider that uses API key authentication:

| Provider | Env var | Default scheme |
|----------|---------|----------------|
| NVIDIA NIM | `NVIDIA_API_KEYS` | Bearer |
| OpenRouter | `OPENROUTER_API_KEYS` | Bearer |
| Anthropic | `ANTHROPIC_API_KEYS` | Bearer |
| OpenAI | `OPENAI_API_KEYS` | Bearer |
| Any custom | `<PROVIDER>_API_KEYS` | Bearer |

The provider ID must match the `providerID` used in your OpenCode model configuration.

## Development

```bash
git clone https://github.com/bulutmuf/opencode-failover.git
cd opencode-failover
bun install
bun test
```

### Debug mode

```bash
OPENCODE_FAILOVER_DEBUG=1 opencode
```

Logs key injection, quarantine decisions, and provider pool initialization.

### Project structure

```
src/
  index.ts        Plugin factory: hooks wiring + tool
  config.ts       Env + options parser
  state.ts        KeyPool: rotation, quarantine, backoff
  classify.ts     Error classifier: status/body -> action
  state.test.ts   7 tests for rotation and quarantine
  classify.test.ts 14 tests for error classification
documents/
  00-architecture.md
  01-error-patterns.md
  02-quarantine-strategy.md
  03-decisions.md
```

## Architecture

See [documents/](documents/) for detailed Architecture Decision Records:

- [Architecture Overview](documents/00-architecture.md) -- hook surface, module layout, opencode integration
- [Error Classification](documents/01-error-patterns.md) -- decision table, pattern matching, retry-after parsing
- [Quarantine Strategy](documents/02-quarantine-strategy.md) -- exponential backoff, cap, recovery semantics
- [Design Decisions](documents/03-decisions.md) -- naming, scope, config precedence, distribution

## License

[MIT](LICENSE)
