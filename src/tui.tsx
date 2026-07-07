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
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
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

function feedKeystrokes(api: any, text: string, delay: number): void {
  setTimeout(() => {
    const stdin = (api.renderer as unknown as { stdin?: { emit: (e: string, d: unknown) => unknown } }).stdin
    stdin?.emit("data", Buffer.from(text))
  }, delay)
}

const tui: TuiPlugin = async (api) => {

  let cachedProviderData: Array<any> | null = null

  async function fetchProviderData(): Promise<Array<any>> {
    try {
      const res = await api.client.provider.list({})
      return ((res as any).data?.all) ?? [...api.state.provider]
    } catch {
      return [...api.state.provider]
    }
  }

  void fetchProviderData().then((data) => { cachedProviderData = data })

  async function openDashboard() {
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

    let providerData: Array<{ id: string; models: Record<string, { name?: string }> }> = []
    if (cachedProviderData) {
      const cachedIds = new Set(cachedProviderData.map((p: any) => p.id))
      const missing = [...keychainIds].filter((id) => !cachedIds.has(id))
      if (missing.length > 0) {
        cachedProviderData = null
      }
    }
    if (cachedProviderData) {
      providerData = cachedProviderData as typeof providerData
    } else {
      try {
        const res = await api.client.provider.list({})
        const resp = res as { data?: { all?: unknown[] } }
        providerData = (resp.data?.all as typeof providerData) ?? []
      } catch (e) {
        providerData = [...api.state.provider] as typeof providerData
      }
      cachedProviderData = providerData
    }
    const options: Array<{ title: string; value: unknown; description: string; category: string }> = []

    for (const p of providerData) {
      if (!keychainIds.has(p.id)) continue
      const name = displayName(p.id)
      const kp = keychain?.providers.find((x) => x.id === p.id)
      const active = kp?.keys.filter((k) => k.status === "active").length ?? 0
      const quarantined = kp?.keys.filter((k) => k.status === "quarantined").length ?? 0
      const parts = [`${active} active`]
      if (quarantined) parts.push(`${quarantined} quarantined`)
      const category = `${name}  —  ${parts.join(" · ")}`
      for (const [mid, m] of Object.entries(p.models ?? {})) {
        const title = (m as Record<string, string>).name ?? mid
        options.push({
          title,
          value: { providerID: p.id, modelID: mid, label: title, providerName: name },
          description: name,
          category,
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
      onSelect(opt: { value: { providerID: string; modelID: string; label: string; providerName: string } }) {
        const { label, providerID } = opt.value
        api.ui.dialog.clear()

        setTimeout(() => {
          api.keymap.dispatchCommand("model.list")
          feedKeystrokes(api, providerID, 80)
          feedKeystrokes(api, ` ${label}`, 160)
          feedKeystrokes(api, "\r", 260)
        }, 30)
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
