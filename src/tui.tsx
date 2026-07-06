/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"

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

function sharedStatePath(): string {
  const configDir = Bun.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "failover-state.json")
}

interface SharedKeyState {
  key: string; status: string; weight: number
  quarantinedUntil: number; consecutiveErrors: number
  lastErrorAt: number; lastErrorMessage: string; retryAfterMs: number | null
}
interface SharedProviderState { id: string; name: string; keys: SharedKeyState[]; hasNativeBackup: boolean }
interface SharedState { version: string; updatedAt: number; providers: SharedProviderState[] }

function readSharedState(): SharedState | null {
  const p = sharedStatePath()
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, "utf-8")) }
  catch { return null }
}

function keySummary(p: SharedProviderState): string {
  const active = p.keys.filter((k) => k.status === "active").length
  const quarantined = p.keys.filter((k) => k.status === "quarantined").length
  const disabled = p.keys.filter((k) => k.status === "disabled").length
  const parts: string[] = []
  if (active) parts.push(`${active} active`)
  if (quarantined) parts.push(`${quarantined} quarantined`)
  if (disabled) parts.push(`${disabled} disabled`)
  return parts.join(", ")
}

function modelLabel(name: string, family?: string): string {
  return family ? `${name} (${family})` : name
}

const tui: TuiPlugin = async (api) => {
  const register = () => {
    // ponytail: re-register on repeated slash to pick up fresh state
  }

  function openDashboard() {
    const keychain = readSharedState()
    const keychainIds = new Set((keychain?.providers ?? []).map((p) => p.id))
    if (keychainIds.size === 0) {
      api.ui.dialog.replace(() => api.ui.DialogAlert({
        title: "Keychain",
        message: "No providers configured.\n\nAdd keys in chat: 'Add these API keys for nvidia: nvapi-xxx, nvapi-yyy'",
        onConfirm: () => api.ui.dialog.clear(),
      }))
      return
    }

    const providerData = [...api.state.provider]
    const options: Array<{ title: string; value: unknown; description: string; category: string }> = []

    for (const p of providerData) {
      if (!keychainIds.has(p.id)) continue
      const kp = keychain?.providers.find((x) => x.id === p.id)
      const summary = kp ? keySummary(kp) : ""
      const name = displayName(p.id)

      for (const [mid, m] of Object.entries(p.models ?? {})) {
        options.push({
          title: modelLabel(m.name ?? mid, (m as Record<string, string>).family),
          value: { providerID: p.id, modelID: mid },
          description: `Provider: ${name} | Keys: ${summary}`,
          category: `${name}${summary ? ` (${summary})` : ""}`,
        })
      }
    }

    if (options.length === 0) {
      api.ui.dialog.replace(() => api.ui.DialogAlert({
        title: "Keychain",
        message: `Providers have keys but no models available.\n\nKeychain providers: ${[...keychainIds].map(displayName).join(", ")}`,
        onConfirm: () => api.ui.dialog.clear(),
      }))
      return
    }

    api.ui.dialog.setSize("large")
    api.ui.dialog.replace(() => api.ui.DialogSelect({
      title: "Keychain — Select Model",
      placeholder: "Search models...",
      options,
      onSelect(opt: { value: { providerID: string; modelID: string } }) {
        api.ui.toast({
          message: `openencode-failover: Selected ${opt.value.providerID}/${opt.value.modelID}`,
          variant: "info",
          duration: 5000,
        })
        api.ui.dialog.clear()
      },
    }))
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "keychain.open",
        title: "Open keychain dashboard",
        desc: "Browse keychain providers & select a model",
        category: "Provider",
        namespace: "palette",
        slashName: "keychain",
        slashAliases: ["failover", "opencode-failover"],
        run: openDashboard,
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-failover",
  tui,
}

export default plugin
