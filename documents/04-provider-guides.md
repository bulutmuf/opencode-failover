# 04 — Provider-specific setup guides

## NVIDIA NIM

NVIDIA NIM uses OpenAI-compatible API with `Authorization: Bearer <key>`.

### Configuration

**Option 1: .env file (recommended)**

Ask the LLM in the TUI:

> Add these NVIDIA API keys for failover rotation: nvapi-xxx, nvapi-yyy, nvapi-zzz

Or create `.env` in your project root:

```bash
NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy,nvapi-zzz"
```

**Option 2: shell env vars**

```bash
NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy,nvapi-zzz"
```

**Option 2: opencode.json**

```json
{
  "plugin": [["opencode-failover", {
    "providers": {
      "nvidia": {
        "keys": ["nvapi-xxx", "nvapi-yyy", "nvapi-zzz"]
      }
    }
  }]]
}
```

### Known behaviors

- Returns `429` with `retry-after` header on rate limit.
- Body contains `TOO_MANY_REQUESTS` or `rate limit` text.
- Rate limits are per-key, not per-account.

### opencode.json provider config

```json
{
  "provider": {
    "nvidia": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://integrate.api.nvidia.com/v1",
      "models": {
        "nvidia/llama-3.1-nemotron-70b-instruct": {}
      }
    }
  }
}
```

## OpenRouter

OpenRouter aggregates multiple providers. Uses `Authorization: Bearer <key>`.

### Configuration

```bash
OPENROUTER_API_KEYS="sk-or-v1-xxx,sk-or-v1-yyy"
```

Or in `opencode.json`:

```json
{
  "plugin": [["opencode-failover", {
    "providers": {
      "openrouter": {
        "keys": ["sk-or-v1-xxx", "sk-or-v1-yyy"]
      }
    }
  }]]
}
```

### Known behaviors

- Returns `429` with standard `retry-after` header.
- Body: `{ "error": { "code": "429", "message": "Rate limit exceeded" } }`
- Rate limits vary by model and plan tier.

### opencode.json provider config

```json
{
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://openrouter.ai/api/v1",
      "models": {
        "anthropic/claude-3.5-sonnet": {}
      }
    }
  }
}
```

## Anthropic

Anthropic uses `x-api-key` header (not `Authorization: Bearer`).

### Configuration

```bash
ANTHROPIC_API_KEYS="sk-ant-xxx,sk-ant-yyy"
```

Or in `opencode.json`:

```json
{
  "plugin": [["opencode-failover", {
    "providers": {
      "anthropic": {
        "keys": ["sk-ant-xxx", "sk-ant-yyy"],
        "header": "x-api-key",
        "scheme": ""
      }
    }
  }]]
}
```

**Important**: Anthropic uses `x-api-key` header with no scheme prefix
(no `Bearer `). Set `"scheme": ""` and `"header": "x-api-key"`.

### Known behaviors

- Returns `429` with `retry-after-ms` header (milliseconds).
- Body: `{ "type": "error", "error": { "type": "too_many_requests" } }`
- Rate limits are per-key, per-model.

### opencode.json provider config

```json
{
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "api": "https://api.anthropic.com/v1",
      "models": {
        "claude-sonnet-4-20250514": {}
      }
    }
  }
}
```

## OpenAI

OpenAI uses `Authorization: Bearer <key>`.

### Configuration

```bash
OPENAI_API_KEYS="sk-xxx,sk-yyy"
```

### Known behaviors

- Returns `429` with `x-ratelimit-reset-requests` and
  `x-ratelimit-reset-tokens` headers (not parsed by plugin — use
  exponential backoff).
- Body: `{ "error": { "code": "rate_limit", "message": "..." } }`
- Rate limits vary by model and tier.

### opencode.json provider config

```json
{
  "provider": {
    "openai": {
      "npm": "@ai-sdk/openai",
      "api": "https://api.openai.com/v1",
      "models": {
        "gpt-4o": {}
      }
    }
  }
}
```

## Cloudflare Workers AI

Cloudflare requires your ccount_id as metadata in addition to the API key.

### Configuration

You can use the JSON OPENCODE_FAILOVER_PROVIDERS var:

`ash
export OPENCODE_FAILOVER_PROVIDERS='{
  "cloudflare": {
    "keys": [
      { "key": "cf-key-1", "meta": { "account_id": "acc-1" } },
      { "key": "cf-key-2", "meta": { "account_id": "acc-2" } }
    ]
  }
}'
`

Or you can use the LLM tool directly in the TUI:

> Add this cloudflare key: xxx with account_id: yyy

## Custom / self-hosted

Any OpenAI-compatible provider (vLLM, llama.cpp, Ollama, LiteLLM, etc.).

### Configuration

```bash
MYPROVIDER_API_KEYS="key1,key2,key3"
```

Or in `opencode.json`:

```json
{
  "plugin": [["opencode-failover", {
    "providers": {
      "my-provider": {
        "keys": ["key1", "key2", "key3"],
        "header": "Authorization",
        "scheme": "Bearer"
      }
    }
  }]]
}
```

### Custom headers

Some providers use non-standard auth headers:

```json
{
  "providers": {
    "custom": {
      "keys": ["key1", "key2"],
      "header": "X-Custom-Auth",
      "scheme": "Token"
    }
  }
}
```

### Weighted rotation

Prioritize faster/cheaper keys:

```json
{
  "providers": {
    "my-provider": {
      "keys": ["fast-key", "slow-key", "backup-key"],
      "weight": {
        "fast-key": 3,
        "slow-key": 1,
        "backup-key": 1
      }
    }
  }
}
```

This gives `fast-key` 3 out of 5 slots (60% of requests).

## Weighted rotation example

Three keys with weights `fast:3`, `medium:1`, `slow:1`:

```
Slots: [fast, fast, fast, medium, slow]
Rotation: fast → fast → fast → medium → slow → fast → ...
```

If `fast` is quarantined:

```
Active: [medium, slow]
Slots: [medium, slow]
Rotation: medium → slow → medium → slow → ...
```

When `fast` recovers:

```
Active: [fast, medium, slow]
Slots: [fast, fast, fast, medium, slow]
Rotation: fast → fast → fast → medium → slow → ...
```

