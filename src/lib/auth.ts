import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

type AuthEntry = {
  type: string
  key: string
  metadata?: Record<string, string>
  accountId?: string
  token?: string
  refresh?: string
  access?: string
  expires?: number
  enterpriseUrl?: string
}

function authFilePath(): string {
  if (Bun.env.OPENCODE_CONFIG_DIR) {
    return path.join(Bun.env.OPENCODE_CONFIG_DIR, "auth.json")
  }
  const xdgData = Bun.env.XDG_DATA_HOME ?? process.env.XDG_DATA_HOME
  if (xdgData) {
    return path.join(xdgData, "opencode", "auth.json")
  }
  const base = Bun.env.HOME ?? Bun.env.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? ""
  return path.join(base, ".local", "share", "opencode", "auth.json")
}

function readAuth(): Record<string, AuthEntry> {
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
  const existing = all[providerID]
  all[providerID] = {
    type: existing?.type ?? "api",
    key,
    ...(existing?.metadata ? { metadata: existing.metadata } : {}),
    ...(existing?.accountId ? { accountId: existing.accountId } : {}),
    ...(existing?.token ? { token: existing.token } : {}),
    ...(existing?.refresh ? { refresh: existing.refresh } : {}),
    ...(existing?.access ? { access: existing.access } : {}),
    ...(existing?.expires ? { expires: existing.expires } : {}),
    ...(existing?.enterpriseUrl ? { enterpriseUrl: existing.enterpriseUrl } : {}),
  }
  writeFileSync(p, JSON.stringify(all, null, 2), { encoding: "utf-8" })
}

export function removeAuthKey(providerID: string): void {
  const all = readAuth()
  if (!all[providerID]) return
  delete all[providerID]
  const p = authFilePath()
  writeFileSync(p, JSON.stringify(all, null, 2), { encoding: "utf-8" })
}
