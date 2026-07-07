import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import path from "node:path"
import os from "node:os"

export interface SharedKeyState {
  key: string
  status: "active" | "quarantined" | "disabled"
  weight: number
  quarantinedUntil: number
  consecutiveErrors: number
  lastErrorAt: number
  lastErrorMessage: string
  retryAfterMs: number | null
}

export interface SharedProviderState {
  id: string
  name: string
  keys: SharedKeyState[]
}

export interface SharedState {
  version: string
  updatedAt: number
  providers: SharedProviderState[]
}

export function sharedStatePath(): string {
  if (Bun.env.OPENCODE_FAILOVER_TEST_DIR) {
    return path.join(Bun.env.OPENCODE_FAILOVER_TEST_DIR, "failover-state.json")
  }
  const configDir = Bun.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode")
  return path.join(configDir, "failover-state.json")
}

function maskKey(key: string): string {
  if (key.length <= 7) return "<key>"
  return `${key.slice(0, 4)}...${key.slice(-3)}`
}

export function writeSharedState(providers: SharedProviderState[]): void {
  const state: SharedState = {
    version: "1.0.0",
    updatedAt: Date.now(),
    providers,
  }
  try {
    const filePath = sharedStatePath()
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
    chmodSync(filePath, 0o600)
  } catch {
    // shared state is best-effort
  }
}

export function readSharedState(): SharedState | null {
  const filePath = sharedStatePath()
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as SharedState
  } catch {
    return null
  }
}

export function maskKeyExport(key: string): string {
  return maskKey(key)
}
