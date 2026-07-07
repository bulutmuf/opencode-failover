# 06 — Security considerations

## API key safety

API keys are loaded at plugin startup from environment variables (`.env`). The plugin acts as a keychain manager.

### File Storage

- **`~/.env` (or project `.env`)**: When using the `keychain-setup` tool, keys are securely appended to your `.env` file.
- **`~/.config/opencode/failover-state.json`**: This file stores the *state* (weights, quarantine timers) of the pool. **Keys are masked** in this file (`nvapi...abc`) so it is safe.
- **`~/.local/share/opencode/auth.json`**: The plugin backs up and restores OpenCode's native keys here to ensure a seamless fallback when you disable the plugin. The keys written here are your actual keys.

### Key masking

The plugin masks keys in all output:

- **Debug logs**: `nvapi...abc` (first 4 + last 4 characters)
- **keychain-status tool**: `nvapi...abc` (first 4 + last 3 characters)
- **State file (`failover-state.json`)**: `nvapi...abc`
- **Error messages**: Keys are never included in error output

### What is NOT masked

- The full key is present in the `Authorization` header injected into LLM requests. This is necessary for authentication — OpenCode sends the header to the provider's API endpoint over HTTPS.
- The key is present in the in-memory `KeyPool` state. This is unavoidable for rotation logic.

## Environment variables

Per-provider env vars are the safest option because:
- They follow the same pattern as opencode's own provider keys.
- They are less likely to be accidentally committed (each provider has a distinct env var name).
- They can be managed via `.env` files with `.gitignore` protection.

### .env file safety

If using `.env` files:

1. Add `.env` to `.gitignore` (already included in this repo's `.gitignore`).
2. Never commit `.env` files to version control.
3. Use `.env.example` with placeholder values for documentation.

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
4. Use `OPENCODE_FAILOVER_DEBUG=0` (or omit it) in production to avoid logging key metadata.

## Production risks

| Risk | Mitigation |
|---|---|
| Keys in env vars visible in `/proc/<pid>/environ` | Restrict process visibility |
| Keys in memory dump | Plugin holds minimal state; keys are short-lived in memory |
| Keys logged by opencode itself | opencode masks provider keys in its own logs |
| Keys in debug logs | Debug mode is opt-in (`OPENCODE_FAILOVER_DEBUG=1`) |
