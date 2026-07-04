import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { validateProviderConfig, loadProviderConfig, providerIDs, envFilePath, readEnvFile, writeEnvKey, removeEnvKey } from "./config.ts"
import { KeyPool } from "./state.ts"
import { classify, ErrorAction } from "./classify.ts"

const DEBUG = Boolean(Bun.env.OPENCODE_FAILOVER_DEBUG)

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
      "keychain.status": tool({
        description: "Show the current state of all configured API keys: active, quarantined, disabled, weights, and retry timers. No arguments needed.",
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
          return lines.join("\n") || "No providers configured. Add keys by telling me: 'Add these API keys for <provider>: <key1>, <key2>'"
        },
      }),

      "keychain.setup": tool({
        description: "Save API keys for a provider so the plugin can rotate between them. When the user asks to add API keys, extract the provider name and keys from their message and call this tool. The user should provide the provider name (e.g. nvidia, openrouter, anthropic) and one or more comma-separated API keys.",
        args: {
          provider: tool.schema.string().describe("Provider name, e.g. nvidia, openrouter, anthropic, openai"),
          keys: tool.schema.string().describe("One or more comma-separated API keys, e.g. nvapi-xxx,nvapi-yyy"),
        },
        async execute({ provider, keys }) {
          const envPath = envFilePath(input.directory)
          const envKey = `${provider.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEYS`
          const keyList = keys.split(",").map((k) => k.trim()).filter(Boolean)
          if (keyList.length === 0) return "No valid keys provided."
          await writeEnvKey(envPath, envKey, keyList.join(","))
          Bun.env[envKey] = keyList.join(",")
          const poolIds = pool.allProviderIDs()
          if (!poolIds.includes(provider)) {
            pool.register(provider, { keys: keyList, header: "Authorization", scheme: "Bearer" })
          }
          log(input, `saved ${keyList.length} keys for ${provider}`, { provider, count: keyList.length })
          await input.client.tui.showToast({
            body: {
              message: `Saved ${keyList.length} key(s) for ${provider}. Restart OpenCode to apply.`,
              variant: "success",
            },
          })
          return `Saved ${keyList.length} key(s) for ${provider} to ${envPath}. Restart OpenCode to apply.`
        },
      }),

      "keychain.remove": tool({
        description: "Remove all API keys for a provider from the .env file. When the user asks to remove keys, extract the provider name and call this tool.",
        args: {
          provider: tool.schema.string().describe("Provider name to remove keys for, e.g. nvidia, openrouter"),
        },
        async execute({ provider }) {
          const envPath = envFilePath(input.directory)
          const envKey = `${provider.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEYS`
          const removed = await removeEnvKey(envPath, envKey)
          delete Bun.env[envKey]
          log(input, `removed keys for ${provider}`, { provider })
          await input.client.tui.showToast({
            body: {
              message: removed ? `Removed ${provider} keys. Restart OpenCode to apply.` : `No keys found for ${provider}.`,
              variant: removed ? "success" : "info",
            },
          })
          return removed ? `Removed ${provider} keys from ${envPath}. Restart OpenCode to apply.` : `No keys found for ${provider} in ${envPath}.`
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
