import type { ProviderConfig } from "./config.ts"
import { writeSharedState, type SharedProviderState, type SharedKeyState } from "./shared.ts"

export type KeyStatus = "active" | "quarantined" | "disabled"

export interface KeyState {
  key: string
  weight: number
  status: KeyStatus
  quarantinedUntil: number
  consecutiveErrors: number
  lastErrorAt: number
  lastErrorMessage: string
  retryAfterMs: number | null
}

export type KeyMetadata = Pick<KeyState, "status" | "quarantinedUntil" | "consecutiveErrors" | "lastErrorAt" | "lastErrorMessage" | "retryAfterMs">

const QUARANTINE_BASE_MS = 60_000
const QUARANTINE_CAP_MS = 300_000

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
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
}

function displayName(id: string): string {
  return PROVIDER_DISPLAY[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

function maskKey(key: string): string {
  if (key.length <= 7) return "<key>"
  return `${key.slice(0, 4)}...${key.slice(-3)}`
}

export class KeyPool {
  private pools = new Map<string, KeyState[]>()
  private indexes = new Map<string, number>()

  private serialize(): void {
    const providers: SharedProviderState[] = []
    for (const providerID of this.pools.keys()) {
      const keys = this.pools.get(providerID)!
      const sharedKeys: SharedKeyState[] = keys.map((k) => ({
        key: maskKey(k.key),
        status: k.status,
        weight: k.weight,
        quarantinedUntil: k.quarantinedUntil,
        consecutiveErrors: k.consecutiveErrors,
        lastErrorAt: k.lastErrorAt,
        lastErrorMessage: k.lastErrorMessage,
        retryAfterMs: k.retryAfterMs,
      }))
      providers.push({
        id: providerID,
        name: displayName(providerID),
        keys: sharedKeys,
      })
    }
    writeSharedState(providers)
  }

  register(providerID: string, config: ProviderConfig): void {
    const weight = config.weight ?? {}
    const now = Date.now()
    this.pools.set(
      providerID,
      config.keys.map((key, i) => ({
        key,
        weight: weight[key] ?? 1,
        status: "active" as KeyStatus,
        quarantinedUntil: 0,
        consecutiveErrors: 0,
        lastErrorAt: 0,
        lastErrorMessage: "",
        retryAfterMs: null,
      })),
    )
    this.indexes.set(providerID, 0)
    this.serialize()
  }

  private pool(providerID: string): KeyState[] {
    const pool = this.pools.get(providerID)
    if (!pool) throw new Error(`Provider "${providerID}" not registered`)
    return pool
  }

  pick(providerID: string): string {
    const pool = this.pool(providerID)
    const now = Date.now()
    const released = pool.filter((k) => k.status === "quarantined" && (k.quarantinedUntil === 0 || now >= k.quarantinedUntil))
    for (const k of released) {
      k.status = "active"
      k.consecutiveErrors = 0
      if (k.quarantinedUntil === 0) k.quarantinedUntil = now
    }
    const available = pool.filter((k) => k.status !== "disabled")
    const active = available.filter((k) => k.status === "active")
    if (active.length === 0) {
      const quarantined = available.filter((k) => k.status === "quarantined")
      if (quarantined.length === 0) throw new Error(`No active keys available for provider "${providerID}"`)
      const earliest = quarantined.reduce((best, curr) => curr.quarantinedUntil < best.quarantinedUntil ? curr : best)
      earliest.status = "active"
      earliest.consecutiveErrors = 0
      active.push(earliest)
    }
    const slots: string[] = []
    for (const k of active) {
      for (let w = 0; w < k.weight; w++) slots.push(k.key)
    }
    const idx = (this.indexes.get(providerID)! + 1) % slots.length
    this.indexes.set(providerID, idx)
    return slots[idx]!
  }

  quarantine(providerID: string, key: string, retryAfterMs: number | null, reason: string): void {
    const entry = this.pool(providerID).find((k) => k.key === key)
    if (!entry) return
    
    entry.status = "quarantined"
    entry.consecutiveErrors++
    const base = QUARANTINE_BASE_MS
    const factor = Math.min(entry.consecutiveErrors - 1, 4)
    const exp = QUARANTINE_CAP_MS
    const fallbackMs = Math.min(base * Math.pow(2, factor), exp)
    const quarantineMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : fallbackMs
    entry.quarantinedUntil = Date.now() + quarantineMs
    entry.lastErrorAt = Date.now()
    entry.lastErrorMessage = reason
    entry.retryAfterMs = retryAfterMs
    this.serialize()
  }

  disable(providerID: string, key: string, reason: string): void {
    const entry = this.pool(providerID).find((k) => k.key === key)
    if (!entry) return
    entry.status = "disabled"
    entry.lastErrorAt = Date.now()
    entry.lastErrorMessage = reason
    this.serialize()
  }

  status(providerID: string): KeyState[] {
    return [...this.pool(providerID)]
  }

  resetAll(providerID: string): void {
    const pool = this.pools.get(providerID)
    if (!pool) return
    for (const k of pool) {
      k.status = "active"
      k.consecutiveErrors = 0
      k.quarantinedUntil = 0
      k.retryAfterMs = null
      k.lastErrorMessage = ""
    }
    this.serialize()
  }

  allProviderIDs(): string[] {
    return Array.from(this.pools.keys())
  }
}
