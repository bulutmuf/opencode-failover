/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { readSharedState } from "./shared.js"

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

function keyStatusBadge(k: { status: string; quarantinedUntil: number }): string {
  if (k.status === "active") return "OK"
  if (k.status === "disabled") return "OFF"
  const remaining = k.quarantinedUntil - Date.now()
  if (remaining <= 0) return "OK"
  const secs = Math.ceil(remaining / 1000)
  return `${secs}s`
}

function keyLabel(k: Record<string, unknown>): string {
  const mask = String(k.key ?? "<key>")
  const masked = mask.length > 7 ? `${mask.slice(0, 4)}...${mask.slice(-3)}` : "<key>"
  const weight = (k.weight as number) > 1 ? ` (${k.weight}x)` : ""
  return `${masked}${weight} [${keyStatusBadge(k as { status: string; quarantinedUntil: number })}]`
}

const command = {
  open: "keychain.open",
  close: "keychain.close",
} as const

function buildDashboardMessage(): string {
  const state = readSharedState()
  if (!state || state.providers.length === 0) {
    return "No providers configured.\n\nAdd keys by telling the AI:\n'Add these API keys for nvidia: nvapi-xxx, nvapi-yyy'"
  }

  const lines: string[] = []
  for (const p of state.providers) {
    const name = displayName(p.id)
    const active = p.keys.filter((k) => k.status === "active").length
    const quarantined = p.keys.filter((k) => k.status === "quarantined").length
    const disabled = p.keys.filter((k) => k.status === "disabled").length

    lines.push(`${name} (${p.keys.length} keys: ${active} active, ${quarantined} quarantined, ${disabled} disabled)`)
    for (const k of p.keys) {
      lines.push(`  ${keyLabel(k)}`)
    }
    if (p.hasNativeBackup) lines.push(`  [native key backed up]`)
  }

  return lines.join("\n")
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
          const msg = buildDashboardMessage()
          api.ui.dialog.replace(() => api.ui.DialogAlert({
            title: "Keychain",
            message: msg,
            onConfirm: () => api.ui.dialog.clear(),
          }))
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
