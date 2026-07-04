# 09 — Frequently asked questions

## Provider compatibility

### Which providers are supported?

Any provider that:
1. Reads an `Authorization: Bearer <key>` header (or custom header).
2. Returns `429` or rate-limit error patterns on quota exceeded.
3. Is configured as an OpenAI-compatible provider in `opencode.json`.

Tested providers: NVIDIA NIM, OpenRouter, Anthropic (with `x-api-key` header),
OpenAI. Any self-hosted provider (vLLM, llama.cpp, Ollama, LiteLLM) works
if it returns standard HTTP error codes.

### Can I use different providers simultaneously?

Yes. Each provider has its own key pool. Configure multiple providers:

```bash
NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy"
OPENROUTER_API_KEYS="sk-or-v1-xxx,sk-or-v1-yyy"
```

The plugin maintains separate pools and rotates independently per provider.

### Does it work with non-OpenAI providers?

Yes, if the provider accepts an `Authorization` header. For providers using
non-standard headers (e.g., Anthropic's `x-api-key`), configure the header
name and scheme:

```json
{
  "providers": {
    "anthropic": {
      "keys": ["sk-ant-xxx"],
      "header": "x-api-key",
      "scheme": ""
    }
  }
}
```

## Key pools

### Can I have different key counts per provider?

Yes. Each provider's pool is independent:

```bash
NVIDIA_API_KEYS="key1,key2,key3"          # 3 keys
OPENROUTER_API_KEYS="key1,key2"           # 2 keys
ANTHROPIC_API_KEYS="key1"                 # 1 key (no rotation)
```

### What happens with a single key?

No rotation occurs. The key is used for every request. If it gets
quarantined, it is released when the quarantine expires (or immediately
if it is the only key — all-quarantined fallback).

### How do weights work?

Weights control the proportion of requests each key receives:

```json
{
  "providers": {
    "nvidia": {
      "keys": ["fast", "slow", "backup"],
      "weight": { "fast": 3, "slow": 1, "backup": 1 }
    }
  }
}
```

`fast` gets 3/5 = 60% of requests. `slow` and `backup` each get 20%.
Default weight is 1 (equal share).

## Opencode interaction

### Does this replace opencode's built-in retry?

No. opencode retries on the same key with backoff derived from
`retry-after`. The plugin changes the key for the NEXT request, not the
current retry cycle. Both mechanisms work together:
1. opencode retries the same key (may succeed on transient 5xx).
2. If it fails again, `session.error` fires, plugin quarantines the key.
3. The next request uses a different key.

### Can I use this with opencode's provider hooks?

Yes. The plugin uses `chat.headers` to inject keys, which works with any
provider configured in `opencode.json`. It does not conflict with
opencode's own provider registration.

### Does it work with the native runtime?

Yes. The plugin hooks into opencode's plugin system, which is shared by
both the AI SDK and native runtime paths. `chat.headers` is called before
every LLM request regardless of runtime.

## Hot-reload

### Can I add/remove keys without restarting?

Not in v1. Keys are loaded at plugin startup. To change keys:
1. Update env vars or `opencode.json`.
2. Restart opencode.

A `keychain.reload` tool is planned for v0.2.0 that re-reads config
without restart.

### Does the plugin persist state across restarts?

No. The key pool is in-memory only. All quarantine timers and
consecutive error counts are lost on restart. This is acceptable because:
- Provider rate limits typically reset within minutes.
- Keys start as `active` on fresh start, which is the correct default.

## Debugging

### How do I see what the plugin is doing?

Set `OPENCODE_FAILOVER_DEBUG=1`:

```bash
OPENCODE_FAILOVER_DEBUG=1 opencode
```

Logs include key injection (masked), quarantine decisions, and pool
initialization.

### How do I check key status?

Use the `keychain.status` tool from the TUI:

```
/keychain.status
```

Or ask the LLM: "Show me the keychain status"

### What does "quarantined" mean?

The key was rate-limited (429, 5xx, or overload pattern). It is skipped
for a duration based on exponential backoff (60s → 120s → 240s → 300s cap).
If a `retry-after` header was present, that value is used instead.

### What does "disabled" mean?

The key failed with an auth error (401, 402, 403). It is permanently
removed from rotation. Check the key at the provider's dashboard and
regenerate if needed.

## Edge cases

### What if all keys are quarantined?

The plugin releases the key with the earliest quarantine timer (soonest
to recover). This prevents a hard failure when the entire pool is
temporarily exhausted.

### What if all keys are disabled?

`pick()` throws an error. opencode surfaces this to the user. You must
configure valid keys and restart.

### What if the provider ID doesn't match?

The plugin only rotates keys for configured providers. If the model's
`providerID` is not in the plugin's pool, `chat.headers` throws. Check
your `opencode.json` provider configuration.

### What about key leakage in logs?

Keys are masked in all plugin output:
- Debug logs: `nvapi...abc` (first 4 + last 4)
- `keychain.status`: `nvapi...abc` (first 4 + last 3)
- Error messages: keys are never included

The full key is present in the `Authorization` header sent to the
provider over HTTPS. This is necessary for authentication.
