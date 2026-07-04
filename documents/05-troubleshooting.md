# 05 — Troubleshooting

## Key quarantined but still getting 429

**Symptom**: A key is quarantined, but opencode still returns 429 on the
same provider.

**Cause**: opencode retries on the SAME key before the plugin's quarantine
takes effect. This is by design — opencode's own retry logic
(`packages/opencode/src/session/retry.ts`) fires in-place with backoff
derived from `retry-after`. The plugin can only change the key for the NEXT
attempt, not the current retry cycle.

**Fix**: Wait for the current retry cycle to complete. The next request will
use a different key. If 429 persists, the key may need a longer quarantine
— check `keychain-status` for the quarantine timer.

## All keys disabled (401/403)

**Symptom**: `keychain-status` shows all keys as DISABLED.

**Cause**: All configured API keys are invalid, revoked, or lack permissions.

**Fix**:
1. Check each key at the provider's dashboard.
2. Generate new keys.
3. Update config (env or `opencode.json`) and restart OpenCode.
4. Disabled keys cannot be re-enabled without restarting — they are
   permanently removed from rotation.

## Plugin not loading

**Symptom**: opencode starts but keys are not being rotated.

**Possible causes**:

1. **JSON syntax error in env var**: `OPENCODE_FAILOVER_PROVIDERS` contains
   invalid JSON. Fix: validate with `echo $OPENCODE_FAILOVER_PROVIDERS | jq .`
   (or use a JSON linter).

2. **Wrong provider ID**: The provider ID in config does not match the
   `providerID` in opencode's model config. Fix: check `opencode.json` for
   the provider ID (e.g., `"nvidia"`, `"openrouter"`, `"anthropic"`).

3. **No keys configured**: The plugin skips providers with no keys —
   opencode's native key handling takes over. Fix: ask the LLM to add
   keys (e.g., "Add these API keys for nvidia: key1, key2"), or create
   a `.env` file with `{PROVIDER}_API_KEYS=key1,key2`.

4. **Plugin not in opencode.json**: The plugin is installed but not listed
   in the `"plugin"` array. Fix: add `"opencode-failover"` to the plugin
   list.

5. **.env file not in project root**: The plugin reads `.env` from the
   project directory. Fix: ensure `.env` is at the same level as
   `opencode.json`, or set `OPENCODE_FAILOVER_ENV_FILE` to a custom path.

## .env file not being read

**Symptom**: Keys in `.env` file are not picked up by the plugin.

**Possible causes**:

1. **File not in project root**: The plugin reads `.env` from the project
   directory (where `opencode.json` lives). Fix: move `.env` to the correct
   location, or set `OPENCODE_FAILOVER_ENV_FILE=/path/to/.env`.

2. **Wrong key format**: The `.env` file must use `{PROVIDER}_API_KEYS=...`
   format. Fix: check the key name matches the provider ID (e.g.,
   `NVIDIA_API_KEYS` for provider `nvidia`).

3. **Shell env overrides .env**: If the same key is set as a shell env var,
   the shell value takes precedence. Fix: unset the shell var or update it.

## Rotation not working (same key used every time)

**Symptom**: All requests use the same key despite multiple keys being
configured.

**Possible causes**:

1. **providerID mismatch**: The model's `providerID` does not match the
   configured provider ID. Fix: run `keychain-status` to see which providers
   are configured, and compare with your model's provider ID.

2. **Single key**: Only one key is configured — rotation has nothing to
   rotate to. Fix: add more keys.

3. **All keys quarantined**: All keys are quarantined, so `pick()` releases
   the earliest one. Fix: wait for quarantine timers to expire, or check
   that keys are actually valid.

## Debug mode

Set `OPENCODE_FAILOVER_DEBUG=1` to see detailed logs:

```bash
OPENCODE_FAILOVER_DEBUG=1 opencode
```

Logs include:
- Key injection per request (masked: `nvapi...xxx`)
- Quarantine/disable decisions with reasons
- Provider pool initialization

Logs are written to opencode's internal logging system via
`client.app.log()`. They appear in the opencode TUI's log output.

## Key pool state inspection

Ask the LLM in the TUI:

> Show me the keychain status

Output format:
```
## nvidia
  nvapi...abc [w=2] — active
  nvapi...def [w=1] — QUARANTINED until 2026-07-04T12:30:00Z
  nvapi...ghi [w=1] — DISABLED: Auth/billing failed (401)
  [1 active, 1 quarantined, 1 disabled]
```

## Common error patterns

| Symptom | Likely cause | Fix |
|---|---|---|
| 429 persists after quarantine | opencode same-key retry | Wait for retry cycle to complete |
| 401 on all keys | Keys revoked/expired | Regenerate keys at provider dashboard |
| Plugin crashes on startup | Invalid JSON in env var | Validate JSON syntax |
| Keys not rotating | providerID mismatch | Check model config vs plugin config |
| All keys quarantined | Provider-wide rate limit | Wait for reset, or add keys from different accounts |
| Debug logs not appearing | `OPENCODE_FAILOVER_DEBUG` not set | Set env var and restart |

## Performance considerations

- The plugin adds minimal overhead: one `pool.pick()` call per LLM request
  (O(1) array access) and one `classify()` call per error event.
- No network calls — all state is in-memory.
- No file I/O — config is read once at startup from env/options.
- The `keychain-status` tool does a linear scan of the pool (negligible for
  typical 2-10 key pools).
