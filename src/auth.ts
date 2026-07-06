import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

function authFilePath(): string {
  if (Bun.env.OPENCODE_CONFIG_DIR) {
    return path.join(Bun.env.OPENCODE_CONFIG_DIR, "auth.json")
  }
  const base = Bun.env.HOME ?? Bun.env.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? ""
  return path.join(base, ".opencode", "auth.json")
}

function readAuth(): Record<string, { type: string; key: string }> {
  const p = authFilePath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, "utf-8"))
  } catch {
    return {}
  }
}

export function writeAuthKey(providerID: string, key: string): void {
  const p = authFilePath()
  const dir = path.dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const all = readAuth()
  all[providerID] = { type: "api", key }
  writeFileSync(p, JSON.stringify(all, null, 2), { encoding: "utf-8" })
}

export function removeAuthKey(providerID: string): void {
  const all = readAuth()
  if (!all[providerID]) return
  delete all[providerID]
  const p = authFilePath()
  writeFileSync(p, JSON.stringify(all, null, 2), { encoding: "utf-8" })
}
