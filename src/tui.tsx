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

function modelLabel(name: string, family?: string): string {
  return family ? `${name} (${family})` : name
}

const tui: TuiPlugin = async (api) => {

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
      const name = displayName(p.id)

      for (const [mid, m] of Object.entries(p.models ?? {})) {
        options.push({
          title: modelLabel(m.name ?? mid, (m as Record<string, string>).family),
          value: { providerID: p.id, modelID: mid },
          description: name,
          category: name,
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
        const { providerID, modelID } = opt.value
        const sessionID = ("params" in api.route.current)
          ? api.route.current.params?.sessionID as string | undefined
          : undefined
        if (!sessionID) {
          api.ui.toast({ message: "opencode-failover: Open a chat session first.", variant: "warning", duration: 3000 })
          api.ui.dialog.clear()
          return
        }
        void api.client.v2.session.switchModel({ sessionID, model: { id: modelID, providerID, variant: "default" } })
          .then(() => {
            api.ui.toast({ message: `openencode-failover: Switched to ${displayName(providerID)} / ${modelID}`, variant: "success", duration: 3000 })
          })
          .catch(() => {
            api.ui.toast({ message: `openencode-failover: Failed to switch model.`, variant: "error", duration: 3000 })
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
