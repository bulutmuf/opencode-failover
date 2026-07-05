import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

export interface AuthEntry {
  type: "api" | "oauth" | "well-known"
  key: string
  metadata?: Record<string, string>
}

type AuthMap = Record<string, AuthEntry>

function authFilePath(): string {
  const base = Bun.env.HOME ?? Bun.env.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? ""
  return path.join(base, ".opencode", "auth.json")
}

export function readAuth(): AuthMap {
  const p = authFilePath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as AuthMap
  } catch {
    return {}
  }
}

function writeAuth(data: AuthMap): void {
  const p = authFilePath()
  const dir = path.dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), { encoding: "utf-8" })
}

export function getNativeAuth(providerID: string): AuthEntry | null {
  const entry = readAuth()[providerID]
  if (entry && entry.type === "api") return entry
  return null
}

export function removeNativeAuth(providerID: string): AuthEntry | null {
  const all = readAuth()
  const entry = all[providerID]
  if (!entry || entry.type !== "api") return null
  delete all[providerID]
  writeAuth(all)
  return entry
}

export function restoreNativeAuth(providerID: string, entry: AuthEntry): void {
  const all = readAuth()
  all[providerID] = entry
  writeAuth(all)
}