/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { readSharedState, type SharedProviderState, type SharedKeyState } from "./shared.ts"

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

function keyStatusBadge(k: SharedKeyState): string {
  if (k.status === "active") return "OK"
  if (k.status === "disabled") return "OFF"
  const remaining = k.quarantinedUntil - Date.now()
  if (remaining <= 0) return "OK"
  const secs = Math.ceil(remaining / 1000)
  return `${secs}s`
}

function keyLabel(k: SharedKeyState): string {
  const masked = k.key.length > 7 ? `${k.key.slice(0, 4)}...${k.key.slice(-3)}` : "<key>"
  const weight = k.weight > 1 ? ` (${k.weight}x)` : ""
  return `${masked}${weight} [${keyStatusBadge(k)}]`
}

const command = {
  open: "keychain.open",
  close: "keychain.close",
} as const

function KeychainDialog(api: TuiPluginApi) {
  const state = readSharedState()
  const providers = state?.providers ?? []
  const [selectedProvider, setSelectedProvider] = createSignal<number>(0)

  if (providers.length === 0) {
    return api.ui.DialogAlert({
      title: "Keychain",
      message: "No providers configured.\n\nAdd keys by telling the AI:\n'Add these API keys for nvidia: nvapi-xxx, nvapi-yyy'",
      onConfirm: () => api.ui.dialog.clear(),
    })
  }

  const provider = providers[selectedProvider()] ?? providers[0]!

  const providerOptions = providers.map((p, i) => ({
    title: `${displayName(p.id)} (${p.keys.length} key${p.keys.length === 1 ? "" : "s"})`,
    value: i,
    description: p.keys.map((k) => keyLabel(k)).join(", "),
    category: "Providers",
  }))

  return api.ui.DialogSelect({
    title: "Keychain",
    placeholder: "Select provider...",
    options: providerOptions,
    current: selectedProvider(),
    onMove: (opt: { value: number }) => setSelectedProvider(opt.value),
    onSelect: () => api.ui.dialog.clear(),
  })
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: command.open,
        title: "Open keychain dashboard",
        desc: "Show API key failover status",
        category: "Provider",
        namespace: "palette",
        slashName: "keychain",
        slashAliases: ["failover", "opencode-failover"],
        run() {
          api.ui.dialog.setSize("medium")
          api.ui.dialog.replace(() => KeychainDialog(api))
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-failover",
  tui,
}

export default plugin
