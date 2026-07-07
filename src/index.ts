import { tool } from "@opencode-ai/plugin"
import { loadProviderConfig, validateProviderConfig, providerIDs, envFilePath, readEnvFile, writeEnvKey, removeEnvKey } from "./config.ts"
import { KeyPool } from "./state.ts"
import { writeAuthKey, removeAuthKey } from "./lib/auth.ts"
import { installFetchPatch, uninstallFetchPatch, registerProvider } from "./lib/fetch-patch.ts"
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

function safeToast(input: any, message: string, variant: string, duration?: number): void {
  void input.client.tui.showToast({ body: { message, variant, duration: duration ?? 5000 } })
}

const PROVIDER_DISPLAY: Record<string, string> = {
  nvidia: "NVIDIA NIM", openrouter: "OpenRouter", anthropic: "Anthropic",
  openai: "OpenAI", google: "Google", groq: "Groq", mistral: "Mistral",
  deepseek: "DeepSeek", copilot: "GitHub Copilot", together: "Together AI",
  fireworks: "Fireworks AI", perplexity: "Perplexity", anyscale: "Anyscale",
  replicate: "Replicate", aws: "AWS Bedrock", azure: "Azure OpenAI",
  cloudflare: "Cloudflare Workers AI",
}

function displayName(id: string): string {
  return PROVIDER_DISPLAY[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function log(input: any, message: string, extra?: Record<string, unknown>) {
  try { input.client.app.log({ body: { service: "opencode-failover", level: "info", message, extra } }) } catch {}
}

function tuiJsonPath(): string {
  const configDir = Bun.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "tui.json")
}

const TUI_PLUGIN_PATH = "./plugins/failover-tui.tsx"

async function autoRegisterTui(input: any): Promise<boolean> {
  try {
    const tuiPath = tuiJsonPath()
    let tuiConfig: Record<string, unknown> = {}
    try {
      if (existsSync(tuiPath)) tuiConfig = JSON.parse(readFileSync(tuiPath, "utf-8"))
    } catch { tuiConfig = {} }
    const plugins = Array.isArray(tuiConfig.plugin) ? tuiConfig.plugin : []
    if (plugins.some((p: unknown) => p === TUI_PLUGIN_PATH || (Array.isArray(p) && p[0] === TUI_PLUGIN_PATH))) return false
    const bakPath = tuiPath + ".bak"
    if (existsSync(tuiPath)) await writeFile(bakPath, readFileSync(tuiPath, "utf-8"))
    tuiConfig.plugin = [...plugins, TUI_PLUGIN_PATH]
    const dir = path.dirname(tuiPath)
    if (!existsSync(dir)) { const { mkdir } = await import("node:fs/promises"); await mkdir(dir, { recursive: true }) }
    await writeFile(tuiPath, JSON.stringify(tuiConfig, null, 2), "utf-8")
    safeToast(input, "opencode-failover: TUI dashboard enabled. Restart to see /keychain.", "info", 8000)
    return true
  } catch { return false }
}

function trackAuthKey(providerID: string, key: string): void {
  writeAuthKey(providerID, key)
}

function clearAuthKey(providerID: string): void {
  removeAuthKey(providerID)
}

export const server = async function(input: any, opts?: unknown) {
  const pool = new KeyPool()
  trace(`failoverPlugin init | directory=${input.directory}`)

  for (const providerID of providerIDs(opts)) {
    const config = validateProviderConfig(providerID, opts)
    pool.register(providerID, config)
    registerProvider(providerID, { header: config.header, scheme: config.scheme })
    trace(`plugin init: registered ${providerID}`, { keyCount: config.keys.length })
  }

  installFetchPatch(input, pool)
  trace(`plugin init DONE | providers=${pool.allProviderIDs().join(', ') || '(none)'}`)

  return {
    dispose: async () => {
      uninstallFetchPatch()
    },

    config: async () => {
      const envPath = envFilePath(input.directory)
      trace(`config hook fired | envPath=${envPath}`)
      const envVars = readEnvFile(envPath)
      for (const [key, value] of envVars) {
        if (!Bun.env[key]) Bun.env[key] = value
      }
      const ids = providerIDs(opts)
      for (const providerID of ids) {
        if (!pool.allProviderIDs().includes(providerID)) {
          const config = loadProviderConfig(providerID, opts)
          if (config) {
            pool.register(providerID, config)
            registerProvider(providerID, { header: config.header, scheme: config.scheme })
          }
        }
      }
      for (const providerID of pool.allProviderIDs()) {
        const keys = pool.status(providerID)
        const firstActive = keys.find((k) => k.status === "active")
        if (firstActive) {
          trackAuthKey(providerID, firstActive.key)
          trace(`config: wrote auth for ${providerID}`)
          safeToast(input, `opencode-failover: Failover active for ${displayName(providerID)}. /keychain to select model.`, "success")
        }
      }
    },

    tool: {
      "keychain-status": tool({
        description: "opencode-failover: Show live status of all API keys — active, quarantined, disabled, weights, retry timers.",
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
            lines.push(`  ### Summary: ${active} active, ${quarantined} quarantined, ${disabled} disabled`)
            lines.push("")
          }
          return pool.allProviderIDs().length === 0
            ? "opencode-failover: No providers configured. Add keys: 'Add these API keys for <provider>: <key1>, <key2>'"
            : lines.join("\n")
        },
      }),

      "keychain-setup": tool({
        description: "opencode-failover: Save API keys for a provider. Extract provider and keys from the message.",
        args: {
          provider: tool.schema.string().describe("Provider name, e.g. nvidia, openrouter"),
          keys: tool.schema.string().describe("Comma-separated API keys, e.g. nvapi-xxx,nvapi-yyy"),
        },
        async execute({ provider, keys }: { provider: string; keys: string }) {
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
          registerProvider(provider, { header: "Authorization", scheme: "Bearer" })
          trackAuthKey(provider, merged[0]!)
          log(input, `saved ${newKeys.length} key(s) for ${provider}`)
          safeToast(input, `Saved ${newKeys.length} key(s) for ${displayName(provider)}.`, "success")
          return `Saved ${newKeys.length} key(s) for ${displayName(provider)}. Total: ${merged.length} in ${envPath}.`
        },
      }),

      "keychain-remove": tool({
        description: "opencode-failover: Remove API keys. Without 'key' arg: removes ALL. With 'key': removes specific key(s).",
        args: {
          provider: tool.schema.string().describe("Provider name"),
          key: tool.schema.string().optional().describe("Optional: key(s) to remove, comma-separated"),
        },
        async execute({ provider, key }: { provider: string; key?: string }) {
          const envPath = envFilePath(input.directory)
          const envKey = `${provider.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEYS`
          const existingRaw = Bun.env[envKey]
          const existingKeys = existingRaw ? existingRaw.split(",").map((k) => k.trim()).filter(Boolean) : []
          if (existingKeys.length === 0) return `No keys found for ${displayName(provider)}.`
          if (key) {
            const toRemove = key.split(",").map((k) => k.trim()).filter(Boolean)
            const remaining = existingKeys.filter((k) => !toRemove.includes(k))
            if (remaining.length === existingKeys.length) return `Specified key(s) not found.`
            if (remaining.length === 0) {
              await removeEnvKey(envPath, envKey)
              delete Bun.env[envKey]
              clearAuthKey(provider)
            } else {
              await writeEnvKey(envPath, envKey, remaining.join(","))
              Bun.env[envKey] = remaining.join(",")
              trackAuthKey(provider, remaining[0]!)
            }
            pool.register(provider, { keys: remaining, header: "Authorization", scheme: "Bearer" })
            registerProvider(provider, { header: "Authorization", scheme: "Bearer" })
            safeToast(input, `Removed ${existingKeys.length - remaining.length} key(s).`, "success")
            return `Removed ${existingKeys.length - remaining.length} key(s).`
          }
          await removeEnvKey(envPath, envKey)
          delete Bun.env[envKey]
          clearAuthKey(provider)
          safeToast(input, `Removed all keys from ${displayName(provider)}.`, "success")
          return `Removed all keys.`
        },
      }),

      "keychain-reset": tool({
        description: "opencode-failover: Reset all quarantined keys back to active. No arguments.",
        args: {},
        async execute() {
          const reset: string[] = []
          for (const providerID of pool.allProviderIDs()) {
            const before = pool.status(providerID).filter(k => k.status !== "active").length
            pool.resetAll(providerID)
            reset.push(`${displayName(providerID)}: ${before} keys reset`)
          }
          return reset.length > 0 ? `Reset: ${reset.join(", ")}` : "All keys already active."
        },
      }),
    },
  }
}

export default server
