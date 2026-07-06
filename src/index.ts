import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { loadProviderConfig, validateProviderConfig, providerIDs, envFilePath, readEnvFile, writeEnvKey, removeEnvKey } from "./config.ts"
import { KeyPool } from "./state.ts"
import { classify, ErrorAction } from "./classify.ts"
import { writeAuthKey, removeAuthKey } from "./auth.ts"
import { startVersionChecker, stopVersionChecker } from "./version-check.ts"
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const DEBUG = Boolean(Bun.env.OPENCODE_FAILOVER_DEBUG)

function trace(msg: string, detail?: Record<string, unknown>): void {
  if (!DEBUG) return
  const time = new Date().toISOString().slice(11, 23)
  const suffix = detail ? ` | ${JSON.stringify(detail)}` : ""
  console.error(`[opencode-failover ${time}] ${msg}${suffix}`)
}

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

function tuiJsonPath(): string {
  const configDir = Bun.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "tui.json")
}

const TUI_PLUGIN_ID = "opencode-failover"

async function autoRegisterTui(input: PluginInput): Promise<boolean> {
  const tuiPath = tuiJsonPath()
  let tuiConfig: Record<string, unknown> = {}
  try {
    if (existsSync(tuiPath)) {
      tuiConfig = JSON.parse(readFileSync(tuiPath, "utf-8"))
    }
  } catch {
    tuiConfig = {}
  }
  const plugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
  const already = plugins.some((p: unknown) => p === TUI_PLUGIN_ID || (Array.isArray(p) && p[0] === TUI_PLUGIN_ID))
  if (already) {
    trace(`tui.json: ${TUI_PLUGIN_ID} already registered`)
    return false
  }
  try {
    const bakPath = tuiPath + ".bak"
    if (existsSync(tuiPath)) {
      await writeFile(bakPath, readFileSync(tuiPath, "utf-8"))
      trace(`tui.json backed up to ${bakPath}`)
    }
    tuiConfig.plugin = [...plugins, TUI_PLUGIN_ID]
    const dir = path.dirname(tuiPath)
    if (!existsSync(dir)) {
      const { mkdir } = await import("node:fs/promises")
      await mkdir(dir, { recursive: true })
    }
    await writeFile(tuiPath, JSON.stringify(tuiConfig, null, 2), "utf-8")
    trace(`tui.json: registered ${TUI_PLUGIN_ID}`)
    await input.client.tui.showToast({
      body: { message: "opencode-failover: TUI dashboard enabled. Restart to see /keychain.", variant: "info", duration: 8000 },
    })
    return true
  } catch (e) {
    trace(`tui.json: failed to register`, { error: String(e) })
    return false
  }
}

const activeAuthKey = new Map<string, string>()

function trackAuthKey(providerID: string, key: string): void {
  activeAuthKey.set(providerID, key)
  writeAuthKey(providerID, key)
}

function clearAuthKey(providerID: string): void {
  activeAuthKey.delete(providerID)
  removeAuthKey(providerID)
}

async function failoverPlugin(input: PluginInput, opts?: unknown): Promise<Hooks> {
  const pool = new KeyPool()
  trace(`failoverPlugin init | directory=${input.directory}, opts present=${!!opts}`)

  for (const providerID of providerIDs(opts)) {
    const config = validateProviderConfig(providerID, opts)
    pool.register(providerID, config)
    trace(`plugin init: registered ${providerID}`, { keyCount: config.keys.length })
  }

  trace(`plugin init DONE | providers=${pool.allProviderIDs().join(', ') || '(none)'}`)

  startVersionChecker(input)

  return {
    dispose: async () => {
      stopVersionChecker()
    },

    config: async (cfg) => {
      const envPath = envFilePath(input.directory)
      trace(`config hook fired | directory=${input.directory}, envPath=${envPath}`)
      const envVars = readEnvFile(envPath)
      trace(`env file read | entries=${envVars.size}`, Object.fromEntries(envVars))
      for (const [key, value] of envVars) {
        if (!Bun.env[key]) Bun.env[key] = value
        trace(`env set: ${key}=${value.slice(0,8)}...`)
      }
      const ids = providerIDs(opts)
      trace(`providerIDs discovered: ${ids.join(', ') || '(none)'}`)
      for (const providerID of ids) {
        if (!pool.allProviderIDs().includes(providerID)) {
          const config = loadProviderConfig(providerID, opts)
          if (config) {
            pool.register(providerID, config)
            trace(`pool registered: ${providerID}`, { keyCount: config.keys.length, header: config.header })
          }
        }
      }
      for (const providerID of pool.allProviderIDs()) {
        const keys = pool.status(providerID)
        const firstActive = keys.find((k) => k.status === "active")
        if (firstActive) {
          trackAuthKey(providerID, firstActive.key)
          trace(`config: wrote auth key for ${providerID}`, { key: firstActive.key.slice(0, 4) + '...' })
          await input.client.tui.showToast({
            body: { message: `opencode-failover: Failover active for ${displayName(providerID)}. /keychain to select model.`, variant: "success" },
          })
        }
      }
      trace(`config hook DONE | pool providers=${pool.allProviderIDs().join(', ') || '(none)'}`)
      await autoRegisterTui(input)
    },

    tool: {
      "keychain-status": tool({
        description: "opencode-failover: Show live status of all API keys — active, quarantined, disabled, weights, retry timers. CALL THIS when the user asks about API key status, key health, rotation state, or says 'show keychain'. No arguments needed.",
        args: {},
        async execute() {
          const lines: string[] = []
          for (const providerID of pool.allProviderIDs()) {
            const keys = pool.status(providerID)
            lines.push(`## ${displayName(providerID)} (${keys.length} key${keys.length === 1 ? "" : "s"})`)
          for (const k of keys) {
            const masked = k.key.length > 7 ? `${k.key.slice(0, 4)}...${k.key.slice(-3)}` : "<key>"
            const weight = k.weight > 1 ? ` — weight: ${k.weight}x` : ""
            if (k.status === "active") {
              lines.push(`  [active]   ${masked}${weight}`)
            } else if (k.status === "quarantined") {
              const until = k.quarantinedUntil ? new Date(k.quarantinedUntil).toISOString() : "now"
              const backoff = k.retryAfterMs ? `${Math.ceil(k.retryAfterMs / 1000)}s` : `${Math.ceil((k.quarantinedUntil - Date.now()) / 1000)}s`
              lines.push(`  [QUAR]     ${masked}${weight} — until: ${until} (${backoff} backoff, error #${k.consecutiveErrors}: ${k.lastErrorMessage})`)
            } else {
              lines.push(`  [DISABLED] ${masked}${weight} — reason: ${k.lastErrorMessage}`)
            }
          }
          const active = keys.filter((k) => k.status === "active").length
          const quarantined = keys.filter((k) => k.status === "quarantined").length
          const disabled = keys.filter((k) => k.status === "disabled").length
          lines.push(`  ### Summary: ${active} active, ${quarantined} quarantined, ${disabled} disabled — ${keys.length} key${keys.length === 1 ? "" : "s"}`)
          lines.push("")
        }
        const totalProviders = pool.allProviderIDs().length
        if (totalProviders === 0) {
          return "opencode-failover: No providers configured. Add keys by telling me: 'Add these API keys for <provider>: <key1>, <key2>'"
        }
        return lines.join("\n")
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
          trackAuthKey(provider, merged[0]!)
          trace(`keychain-setup: wrote auth key for ${provider}`)
          log(input, `saved ${newKeys.length} key(s) for ${provider} (total: ${merged.length})`, { provider, added: newKeys.length, total: merged.length })
          await input.client.tui.showToast({
            body: {
              message: `opencode-failover: Saved ${newKeys.length} key(s) for ${displayName(provider)}. Total: ${merged.length} key(s).`,
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
              body: { message: `opencode-failover: No keys found for ${displayName(provider)}.`, variant: "info" },
            })
            return `opencode-failover: No keys found for ${displayName(provider)} in ${envPath}.`
          }
          if (key) {
            const toRemove = key.split(",").map((k) => k.trim()).filter(Boolean)
            const remaining = existingKeys.filter((k) => !toRemove.includes(k))
            if (remaining.length === existingKeys.length) {
              await input.client.tui.showToast({
                body: { message: `opencode-failover: No matching keys found for ${displayName(provider)}.`, variant: "warning" },
              })
              return `opencode-failover: Specified key(s) not found for ${displayName(provider)} in ${envPath}.`
            }
            if (remaining.length === 0) {
              await removeEnvKey(envPath, envKey)
              delete Bun.env[envKey]
              clearAuthKey(provider)
              trace(`keychain-remove: removed auth.json entry for ${provider}`)
            } else {
              await writeEnvKey(envPath, envKey, remaining.join(","))
              Bun.env[envKey] = remaining.join(",")
              trackAuthKey(provider, remaining[0]!)
            }
            pool.register(provider, { keys: remaining, header: "Authorization", scheme: "Bearer" })
            const removedCount = existingKeys.length - remaining.length
            log(input, `removed ${removedCount} key(s) from ${provider} (total remaining: ${remaining.length})`, { provider, removed: removedCount, remaining: remaining.length })
            await input.client.tui.showToast({
              body: { message: `opencode-failover: Removed ${removedCount} key(s) from ${displayName(provider)}. ${remaining.length} remaining.`, variant: "success" },
            })
            return `opencode-failover: Removed ${removedCount} key(s) from ${displayName(provider)}. Total: ${remaining.length} remaining in ${envPath}.`
          }
          const removed = await removeEnvKey(envPath, envKey)
          delete Bun.env[envKey]
          pool.register(provider, { keys: [], header: "Authorization", scheme: "Bearer" })
          clearAuthKey(provider)
          trace(`keychain-remove: removed all keys + auth.json from ${provider}`)
          log(input, `removed all ${existingKeys.length} key(s) for ${provider}`, { provider, count: existingKeys.length })
          await input.client.tui.showToast({
            body: { message: removed ? `opencode-failover: Removed all ${existingKeys.length} key(s) from ${displayName(provider)}.` : `opencode-failover: No keys found for ${displayName(provider)}.`, variant: removed ? "success" : "info" },
          })
          return removed ? `opencode-failover: Removed all ${existingKeys.length} key(s) from ${displayName(provider)} in ${envPath}.` : `opencode-failover: No keys found for ${displayName(provider)} in ${envPath}.`
        },
      }),
    },

    event: async ({ event }) => {
      trace(`event hook FIRED | type=${event.type}`)
      if (event.type !== "session.error") {
        trace(`event SKIP — not session.error (type=${event.type})`)
        return
      }
      trace(`session.error received`)
      const properties = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
      const error = properties?.error as Record<string, unknown> | undefined
      if (!error) {
        trace(`event SKIP — no error in properties`)
        return
      }

      const result = classify(error)
      trace(`classify result: action=${result.action}, reason=${result.reason}`)
      if (result.action === ErrorAction.Ignore) {
        trace(`event SKIP — classify returned Ignore`)
        return
      }

      let matchedProviderID: string | null = null
      let matchedKey: string | null = null
      for (const [providerID, key] of activeAuthKey.entries()) {
        const poolKeys = pool.status(providerID)
        if (poolKeys.some((k) => k.key === key)) {
          matchedProviderID = providerID
          matchedKey = key
          break
        }
      }
      if (!matchedProviderID || !matchedKey) {
        trace(`event SKIP — no active key matched in pool. activeAuthKey.size=${activeAuthKey.size}`)
        return
      }
      const providerID = matchedProviderID
      const authKey = matchedKey

      const masked = authKey.length > 7 ? `${authKey.slice(0, 4)}...${authKey.slice(-3)}` : "<key>"

      if (result.action === ErrorAction.Disable) {
        pool.disable(providerID, authKey, result.reason)
        const nextKey = pool.pick(providerID)
        trackAuthKey(providerID, nextKey)
        await input.client.tui.showToast({
          body: { message: `opencode-failover: ${displayName(providerID)} key ${masked} disabled — ${result.reason}`, variant: "error" },
        })
      }
      if (result.action === ErrorAction.Rotate) {
        pool.quarantine(providerID, authKey, result.retryAfterMs, result.reason)
        const nextKey = pool.pick(providerID)
        trackAuthKey(providerID, nextKey)
        const maskedNext = nextKey.length > 7 ? `${nextKey.slice(0, 4)}...${nextKey.slice(-3)}` : "<key>"
        const backoffSec = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : 60
        await input.client.tui.showToast({
          body: { message: `opencode-failover: [${displayName(providerID)}] Key ${masked} quarantined (${result.reason}). Switching to ${maskedNext} (${backoffSec}s).`, variant: "warning" },
        })
      }
    },
  }
}

export default failoverPlugin
