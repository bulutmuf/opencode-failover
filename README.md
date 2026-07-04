# opencode-failover

[OpenCode](https://opencode.ai) plugin for automatic API-key failover and rotation across multiple provider keys.

<p>
  <a href="https://www.npmjs.com/package/opencode-failover"><img src="https://img.shields.io/npm/v/opencode-failover?style=flat-square&color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-failover"><img src="https://img.shields.io/npm/dm/opencode-failover?style=flat-square&color=blue" alt="npm downloads"></a>
  <a href="https://github.com/bulutmuf/opencode-failover/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bulutmuf/opencode-failover?style=flat-square" alt="License"></a>
  <a href="https://github.com/bulutmuf/opencode-failover/actions"><img src="https://img.shields.io/github/actions/workflow/status/bulutmuf/opencode-failover/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/bulutmuf/opencode-failover/stargazers"><img src="https://img.shields.io/github/stars/bulutmuf/opencode-failover?style=flat-square" alt="Stars"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Bun-1.0+-FBF0DF?style=flat-square&logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/OpenCode-1.17+-FF6B35?style=flat-square" alt="OpenCode">
  <a href="https://github.com/bulutmuf/opencode-failover/issues"><img src="https://img.shields.io/github/issues/bulutmuf/opencode-failover?style=flat-square" alt="Issues"></a>
  <img src="https://img.shields.io/badge/Test-28%2F28-4CAF50?style=flat-square" alt="Tests">
</p>

<p align="center">
  <video src="https://github.com/bulutmuf/opencode-failover/raw/main/demo.mp4" controls autoplay loop muted width="800"></video>
</p>

---

**opencode-failover** is a [OpenCode](https://opencode.ai) plugin that automatically rotates API keys across multiple provider credentials. When a key hits a rate limit, the plugin quarantines it and switches to the next available key -- zero downtime, zero manual intervention.

- Multiple keys per provider with weighted round-robin distribution
- Automatic quarantine on [rate-limit (429)](#error-classification) with [exponential backoff](#quarantine-schedule)
- Permanent disable on [auth failure (401/403)](#error-classification)
- Works with [NVIDIA NIM](https://build.nvidia.com), [OpenRouter](https://openrouter.ai), [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com), and any OpenCode-compatible provider

## Quick Start

```bash
opencode plugin opencode-failover
```

Set your API keys. Ask the LLM in the TUI (natural language):

> Add these NVIDIA API keys for failover rotation: nvapi-xxx, nvapi-yyy, nvapi-zzz

The plugin saves keys to `.env` and restarts opencode to activate.

Or create `.env` manually:

```bash
NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy,nvapi-zzz"
```

Restart OpenCode. The plugin activates automatically and begins rotating keys.

## Quick Prompt (copy & paste)

Open the opencode TUI and send this to the LLM:

```
Add these NVIDIA API keys for failover rotation: nvapi-key1, nvapi-key2, nvapi-key3
```

The plugin saves them to `.env`. Works immediately in the current session.

To check key status later, ask:

```
Show me the keychain status
```

To remove keys:

```
Remove all NVIDIA API keys from the keychain
```

Or remove a specific key:

```
Remove nvapi-key1 from NVIDIA
```

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
- Rate-limit pattern detection ([Anthropic](https://docs.anthropic.com), [OpenAI](https://platform.openai.com/docs), and generic patterns)
- [`keychain-status`](#tools-llm-natural-language) tool for real-time key monitoring
- Debug logging via `OPENCODE_FAILOVER_DEBUG=1`
- Works with any [OpenCode](https://opencode.ai)-compatible provider

## Installation

### Option 1: OpenCode CLI (recommended)

```bash
opencode plugin opencode-failover
```

This installs the package and updates your [`opencode.json`](https://opencode.ai/docs/config) automatically.

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

Then copy the plugin to your OpenCode [plugins directory](https://opencode.ai/docs/plugins):

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
2. `<PROVIDER>_API_KEYS` env + `opencode.json` options (merged)
3. `opencode.json` options only

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
| [429](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) | Quarantine | Exponential backoff: 60s, 120s, 240s, 300s cap |
| [401](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401) / [403](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403) | Disable | Permanent, requires manual re-enable |
| [402](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402) | Disable | Billing error, permanent |
| [5xx](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#server_error_responses) | Quarantine | Temporary, same backoff as 429 |
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

## Tools (LLM natural language)

These are tools the LLM can call. Say them in natural language:

| Tool | What to say | Description |
|------|-------------|-------------|
| `keychain-setup` | "Add these API keys for nvidia: key1, key2" | Save API keys for a provider to `.env` (appends to existing) |
| `keychain-remove` | "Remove all nvidia API keys" or "Remove key1 from nvidia" | Remove all or specific API keys for a provider from `.env` |
| `keychain-status` | "Show me the keychain status" | Show all configured keys, their status, weights, and retry timers |

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
| [NVIDIA NIM](https://build.nvidia.com) | `NVIDIA_API_KEYS` | Bearer |
| [OpenRouter](https://openrouter.ai) | `OPENROUTER_API_KEYS` | Bearer |
| [Anthropic](https://console.anthropic.com) | `ANTHROPIC_API_KEYS` | Bearer |
| [OpenAI](https://platform.openai.com) | `OPENAI_API_KEYS` | Bearer |
| Any custom | `<PROVIDER>_API_KEYS` | Bearer |

The provider ID must match the `providerID` used in your [OpenCode model configuration](https://opencode.ai/docs/config).

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
  index.ts          Plugin factory: hooks wiring + tool
  config.ts         Env + options parser
  state.ts          KeyPool: rotation, quarantine, backoff
  classify.ts       Error classifier: status/body -> action
  state.test.ts     7 tests for rotation and quarantine
  classify.test.ts  14 tests for error classification
  config.test.ts    7 tests for env provider discovery
documents/
  00-architecture.md
  01-error-patterns.md
  02-quarantine-strategy.md
  03-decisions.md
  04-provider-guides.md
  05-troubleshooting.md
  06-security.md
  07-changelog.md
  08-contributing.md
  09-faq.md
```

## Architecture

See [`documents/`](documents/) for detailed Architecture Decision Records:

| Document | Description |
|----------|-------------|
| [Architecture Overview](documents/00-architecture.md) | Hook surface, module layout, OpenCode integration |
| [Error Classification](documents/01-error-patterns.md) | Decision table, pattern matching, retry-after parsing |
| [Quarantine Strategy](documents/02-quarantine-strategy.md) | Exponential backoff, cap, recovery semantics |
| [Design Decisions](documents/03-decisions.md) | Naming, scope, config precedence, distribution |
| [Provider Guides](documents/04-provider-guides.md) | Per-provider setup (NVIDIA, OpenRouter, Anthropic, OpenAI, custom) |
| [Troubleshooting](documents/05-troubleshooting.md) | Common issues, debug mode, key status inspection |
| [Security](documents/06-security.md) | Key masking, env safety, production risks |
| [Changelog](documents/07-changelog.md) | v0.1.0 release notes |
| [Contributing](documents/08-contributing.md) | Dev setup, commit format, test rules, PR flow |
| [FAQ](documents/09-faq.md) | Provider compatibility, edge cases, debugging |

## Contributing

Contributions are welcome. Please open an [issue](https://github.com/bulutmuf/opencode-failover/issues) or submit a [pull request](https://github.com/bulutmuf/opencode-failover/pulls).

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 [bulutmuf](https://github.com/bulutmuf)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

<p align="center">
  Built for <a href="https://opencode.ai">OpenCode</a>
</p>
