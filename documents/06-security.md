# 06 — Security considerations

## API key safety

API keys are loaded at plugin startup from environment variables or
`opencode.json` options. They are held in-memory only — never written to
disk, logs, or error messages by the plugin itself.

### Key masking

The plugin masks keys in all output:

- **Debug logs**: `nvapi...abc` (first 4 + last 4 characters)
- **keychain.status tool**: `nvapi...abc` (first 4 + last 3 characters)
- **Error messages**: Keys are never included in error output

### What is NOT masked

- The full key is present in the `Authorization` header injected into
  LLM requests. This is necessary for authentication — opencode sends
  the header to the provider's API endpoint over HTTPS.
- The key is present in the in-memory `KeyPool` state. This is
  unavoidable for rotation logic.

## Environment variables

### Recommended: per-provider env vars

```bash
NVIDIA_API_KEYS="nvapi-xxx,nvapi-yyy"
OPENROUTER_API_KEYS="sk-or-v1-xxx,sk-or-v1-yyy"
```

Per-provider env vars are the safest option because:
- They follow the same pattern as opencode's own provider keys.
- They are less likely to be accidentally committed (each provider has
  a distinct env var name).
- They can be managed via `.env` files with `.gitignore` protection.

### Alternative: JSON env var

```bash
OPENCODE_FAILOVER_PROVIDERS='{"nvidia":{"keys":["nvapi-xxx"]}}'
```

The JSON env var is more compact but riskier:
- Easier to accidentally expose the full config in a single env dump.
- Harder to rotate individual keys without rewriting the entire JSON.

### .env file safety

If using `.env` files:

1. Add `.env` to `.gitignore` (already included in this repo's
   `.gitignore`).
2. Never commit `.env` files to version control.
3. Use `.env.example` with placeholder values for documentation:

```bash
# .env.example
NVIDIA_API_KEYS="nvapi-your-key-here"
OPENROUTER_API_KEYS="sk-or-v1-your-key-here"
```

## opencode.json options

Keys in `opencode.json` options are visible to anyone with access to the
file. For public repos, use env vars instead.

```json
{
  "plugin": [["opencode-failover", {
    "providers": {
      "nvidia": {
        "keys": ["nvapi-xxx"]
      }
    }
  }]]
}
```

**Risk**: If `opencode.json` is committed to a public repo, API keys are
exposed.

**Mitigation**: Use env vars for keys in public repos. Reserve
`opencode.json` options for private repos or non-sensitive config (header
names, schemes, weights).

## GitHub Actions / CI

If using this plugin in CI:

1. Store API keys as GitHub Actions secrets.
2. Reference secrets via env vars:

```yaml
- name: Run opencode
  env:
    NVIDIA_API_KEYS: ${{ secrets.NVIDIA_API_KEYS }}
  run: opencode
```

3. Never echo secrets in CI logs.
4. Use `OPENCODE_FAILOVER_DEBUG=0` (or omit it) in production to avoid
   logging key metadata.

## Production risks

| Risk | Mitigation |
|---|---|
| Keys in env vars visible in `/proc/<pid>/environ` | Restrict process visibility |
| Keys in memory dump | Plugin holds minimal state; keys are short-lived in memory |
| Keys in opencode.json committed to public repo | Use env vars for public repos |
| Keys logged by opencode itself | opencode masks provider keys in its own logs |
| Keys in debug logs | Debug mode is opt-in (`OPENCODE_FAILOVER_DEBUG=1`) |

## Key rotation best practices

1. **Rotate keys regularly** — generate new keys and update config
   periodically, even without errors.
2. **Use separate keys per environment** — dev, staging, production.
3. **Monitor key usage** — use `keychain.status` to check for disabled
   keys that indicate auth failures.
4. **Revoke unused keys** — if a key is disabled by the plugin, revoke
   it at the provider dashboard.
5. **Use minimum permissions** — give API keys only the permissions they
   need (e.g., read-only, specific models).

## Private repo strategy

This repo is private during development. When made public:

1. Ensure no API keys are in git history (`git log -p | grep -i "nvapi\|sk-\|key"`).
2. Use env vars for all keys in public-facing configs.
3. Keep `opencode.json` options for non-sensitive config only.
4. Add `.env` to `.gitignore` (already done).
