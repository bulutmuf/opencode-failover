import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { validateProviderConfig, loadProviderConfig, providerIDs, envFilePath, readEnvFile, writeEnvKey, removeEnvKey } from "./config.ts"
import { KeyPool } from "./state.ts"
import { classify, ErrorAction } from "./classify.ts"

const DEBUG = Boolean(Bun.env.OPENCODE_FAILOVER_DEBUG)

const PROVIDER_DISPLAY: Record<string, string> = {
  nvidia: "NVIDIA NIM",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  copilot: "GitHub Copilot",
  together: "Together AI",
  fireworks: "Fireworks AI",
  perplexity: "Perplexity",
  anyscale: "Anyscale",
  replicate: "Replicate",
  aws: "AWS Bedrock",
  azure: "Azure OpenAI",
  cloudflare: "Cloudflare Workers AI",
}

function displayName(id: string): string {
  return PROVIDER_DISPLAY[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function log(input: PluginInput, message: string, extra?: Record<string, unknown>) {
  input.client.app.log({
    body: {
      service: "opencode-failover",
      level: "info",
      message,
      extra,
    },
  })
}

async function failoverPlugin(input: PluginInput, opts?: unknown): Promise<Hooks> {
  const pool = new KeyPool()

  for (const providerID of providerIDs(opts)) {
    const config = validateProviderConfig(providerID, opts)
    pool.register(providerID, config)
  }

  if (DEBUG) log(input, `initialized ${pool.allProviderIDs().length} provider pools`)

  return {
    dispose: async () => {},

    config: async (cfg) => {
      const envPath = envFilePath(input.directory)
      const envVars = readEnvFile(envPath)
      for (const [key, value] of envVars) {
        if (!Bun.env[key]) Bun.env[key] = value
      }
      for (const providerID of providerIDs(opts)) {
        if (!pool.allProviderIDs().includes(providerID)) {
          const config = loadProviderConfig(providerID, opts)
          if (config) pool.register(providerID, config)
        }
      }
    },

    "chat.headers": async (incoming, output) => {
      const providerID = incoming.model.providerID
      const config = loadProviderConfig(providerID, opts)
      if (!config) return
      const key = pool.pick(providerID)
      const headerValue = `${config.scheme} ${key}`
      output.headers = { ...output.headers, [config.header]: headerValue }
      if (DEBUG) {
        const masked = key.length > 4 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "<short-key>"
        log(input, `injected key ${masked} for ${providerID}`, {
          providerID,
          header: config.header,
          sessionID: incoming.sessionID,
        })
      }
    },

    tool: {
      "keychain-status": tool({
        description: "opencode-failover: Show live status of all API keys — active, quarantined, disabled, weights, retry timers. CALL THIS when the user asks about API key status, key health, rotation state, or says 'show keychain'. No arguments needed.",
        args: {},
        async execute() {
          const lines: string[] = []
          for (const providerID of pool.allProviderIDs()) {
            const keys = pool.status(providerID)
            lines.push(`## ${providerID}`)
            for (const k of keys) {
              const masked = k.key.length > 7 ? `${k.key.slice(0, 4)}...${k.key.slice(-3)}` : "<key>"
              const weight = k.weight > 1 ? ` [w=${k.weight}]` : ""
              const status = k.status === "quarantined"
                ? `QUARANTINED until ${k.quarantinedUntil ? new Date(k.quarantinedUntil).toISOString() : "now"}`
                : k.status === "disabled"
                  ? `DISABLED: ${k.lastErrorMessage || "unknown"}`
                  : "active"
              lines.push(`  ${masked}${weight} — ${status}`)
            }
            const active = keys.filter((k) => k.status === "active").length
            const quarantined = keys.filter((k) => k.status === "quarantined").length
            const disabled = keys.filter((k) => k.status === "disabled").length
            lines.push(`  [${active} active, ${quarantined} quarantined, ${disabled} disabled]`)
          }
          return lines.join("\n") || "opencode-failover: No providers configured. Add keys by telling me: 'Add these API keys for <provider>: <key1>, <key2>'"
        },
      }),

      "keychain-setup": tool({
        description: "opencode-failover: Save API keys for a provider. CALL THIS when the user wants to add, save, or set API keys. Extract provider name and comma-separated keys from their message. Requires: provider (string) and keys (comma-separated string).",
        args: {
          provider: tool.schema.string().describe("Provider name, e.g. nvidia, openrouter, anthropic, openai"),
          keys: tool.schema.string().describe("One or more comma-separated API keys, e.g. nvapi-xxx,nvapi-yyy"),
        },
        async execute({ provider, keys }) {
          const envPath = envFilePath(input.directory)
          const envKey = `${provider.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEYS`
          const newKeys = keys.split(",").map((k) => k.trim()).filter(Boolean)
          if (newKeys.length === 0) return "opencode-failover: No valid keys provided."
          const existingRaw = Bun.env[envKey]
          const existingKeys = existingRaw ? existingRaw.split(",").map((k) => k.trim()).filter(Boolean) : []
          const merged = [...new Set([...existingKeys, ...newKeys])]
          await writeEnvKey(envPath, envKey, merged.join(","))
          Bun.env[envKey] = merged.join(",")
          pool.register(provider, { keys: merged, header: "Authorization", scheme: "Bearer" })
          log(input, `saved ${newKeys.length} key(s) for ${provider} (total: ${merged.length})`, { provider, added: newKeys.length, total: merged.length })
          await input.client.tui.showToast({
            body: {
              message: `Saved ${newKeys.length} key(s) for ${displayName(provider)}. Total: ${merged.length} key(s).`,
              variant: "success",
            },
          })
          return `opencode-failover: Saved ${newKeys.length} key(s) for ${displayName(provider)}. Total: ${merged.length} key(s) in ${envPath}.`
        },
      }),

      "keychain-remove": tool({
        description: "opencode-failover: Remove API keys for a provider. CALL THIS when the user wants to remove, delete, or clear API keys. Without 'key' arg: removes ALL keys for the provider. With 'key' arg: removes only the specified key(s).",
        args: {
          provider: tool.schema.string().describe("Provider name, e.g. nvidia, openrouter"),
          key: tool.schema.string().optional().describe("Optional: specific key(s) to remove, comma-separated. If omitted, removes ALL keys for the provider."),
        },
        async execute({ provider, key }) {
          const envPath = envFilePath(input.directory)
          const envKey = `${provider.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEYS`
          const existingRaw = Bun.env[envKey]
          const existingKeys = existingRaw ? existingRaw.split(",").map((k) => k.trim()).filter(Boolean) : []
          if (existingKeys.length === 0) {
            await input.client.tui.showToast({
              body: { message: `No keys found for ${displayName(provider)}.`, variant: "info" },
            })
            return `opencode-failover: No keys found for ${displayName(provider)} in ${envPath}.`
          }
          if (key) {
            const toRemove = key.split(",").map((k) => k.trim()).filter(Boolean)
            const remaining = existingKeys.filter((k) => !toRemove.includes(k))
            if (remaining.length === existingKeys.length) {
              await input.client.tui.showToast({
                body: { message: `Key(s) not found for ${displayName(provider)}.`, variant: "info" },
              })
              return `opencode-failover: Specified key(s) not found for ${displayName(provider)} in ${envPath}.`
            }
            if (remaining.length === 0) {
              await removeEnvKey(envPath, envKey)
              delete Bun.env[envKey]
            } else {
              await writeEnvKey(envPath, envKey, remaining.join(","))
              Bun.env[envKey] = remaining.join(",")
            }
            pool.register(provider, { keys: remaining, header: "Authorization", scheme: "Bearer" })
            const removedCount = existingKeys.length - remaining.length
            log(input, `removed ${removedCount} key(s) from ${provider} (total remaining: ${remaining.length})`, { provider, removed: removedCount, remaining: remaining.length })
            await input.client.tui.showToast({
              body: { message: `Removed ${removedCount} key(s) from ${displayName(provider)}. Total: ${remaining.length} remaining.`, variant: "success" },
            })
            return `opencode-failover: Removed ${removedCount} key(s) from ${displayName(provider)}. Total: ${remaining.length} remaining in ${envPath}.`
          }
          const removed = await removeEnvKey(envPath, envKey)
          delete Bun.env[envKey]
          log(input, `removed all ${existingKeys.length} key(s) for ${provider}`, { provider, count: existingKeys.length })
          await input.client.tui.showToast({
            body: { message: removed ? `Removed all ${existingKeys.length} key(s) from ${displayName(provider)}.` : `No keys found for ${displayName(provider)}.`, variant: removed ? "success" : "info" },
          })
          return removed ? `opencode-failover: Removed all ${existingKeys.length} key(s) from ${displayName(provider)} in ${envPath}.` : `opencode-failover: No keys found for ${displayName(provider)} in ${envPath}.`
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type !== "session.error") return
      const properties = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
      const error = properties?.error as Record<string, unknown> | undefined
      if (!error) return

      const result = classify(error)
      if (result.action === ErrorAction.Ignore) return

      for (const providerID of pool.allProviderIDs()) {
        const keys = pool.status(providerID)
        for (const k of keys) {
          if (k.status === "active" || k.status === "quarantined") {
            const authHeader = `${validateProviderConfig(providerID, opts).scheme} ${k.key}`
            if (containsAuthError(error, authHeader)) {
              if (result.action === ErrorAction.Disable) {
                pool.disable(providerID, k.key, result.reason)
                log(input, `disabled key for ${providerID}: ${result.reason}`, {
                  providerID,
                  reason: result.reason,
                  sessionID: properties?.sessionID,
                })
              }
              if (result.action === ErrorAction.Rotate) {
                pool.quarantine(providerID, k.key, result.retryAfterMs, result.reason)
                log(input, `quarantined key for ${providerID} (${result.retryAfterMs ?? "default"}ms): ${result.reason}`, {
                  providerID,
                  retryAfterMs: result.retryAfterMs,
                  reason: result.reason,
                  sessionID: properties?.sessionID,
                })
              }
              break
            }
          }
        }
      }
    },
  }
}

function containsAuthError(error: Record<string, unknown>, headerValue: string): boolean {
  const body = String(error.responseBody ?? error.body ?? "")
  const message = String(error.message ?? "")
  const combined = `${body} ${message}`.toLowerCase()
  const key = headerValue.toLowerCase()
  return combined.includes(key)
}

export default failoverPlugin
