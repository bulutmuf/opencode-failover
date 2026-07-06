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

// ponytail: keystroke injection — opencode's TUI plugin API
// does not expose local.model.set(). Keystroke injection through
// the built-in model.list dialog is the only known workaround
// (same approach used by @thelioo/opencode-balancer).
function feedKeystrokes(api: TuiPluginApi, text: string, delay: number): void {
  setTimeout(() => {
    const stdin = (api.renderer as unknown as { stdin?: { emit: (e: string, d: unknown) => unknown } }).stdin
    stdin?.emit("data", Buffer.from(text))
  }, delay)
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
    const options: Array<{ title: string; value: unknown; category: string }> = []

    for (const p of providerData) {
      if (!keychainIds.has(p.id)) continue
      const name = displayName(p.id)
      for (const [mid, m] of Object.entries(p.models ?? {})) {
        const title = (m as Record<string, string>).name ?? mid
        options.push({
          title,
          value: { providerID: p.id, modelID: mid, label: title },
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
      onSelect(opt: { value: { providerID: string; modelID: string; label: string } }) {
        const { label } = opt.value
        api.ui.dialog.clear()

        setTimeout(() => {
          api.keymap.dispatchCommand("model.list")
          feedKeystrokes(api, label, 150)
          feedKeystrokes(api, "\r", 230)
          feedKeystrokes(api, "\x1b", 310)
        }, 50)
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
