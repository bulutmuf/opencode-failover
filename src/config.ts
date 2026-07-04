import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"

const ProviderConfigSchema = z.object({
  keys: z.array(z.string().min(1)).min(1),
  header: z.string().default("Authorization"),
  scheme: z.string().default("Bearer"),
  weight: z.record(z.string(), z.number().positive()).optional(),
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

type Options = Record<string, ProviderConfig>

const PROVIDERS_ENV_KEY = "OPENCODE_FAILOVER_PROVIDERS"

export function parseEnvProviders(): Map<string, ProviderConfig> {
  const raw = Bun.env[PROVIDERS_ENV_KEY]
  if (!raw) return new Map()
  let parsed: Record<string, ProviderConfig>
  try {
    parsed = JSON.parse(raw) as Record<string, ProviderConfig>
  } catch {
    return new Map()
  }
  const result = new Map<string, ProviderConfig>()
  for (const [id, cfg] of Object.entries(parsed)) {
    const validated = ProviderConfigSchema.parse(cfg)
    result.set(id, validated)
  }
  return result
}

export function parseEnvKeys(id: string): string[] | null {
  const upcase = id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()
  const raw = Bun.env[`${upcase}_API_KEYS`]
  if (!raw) return null
  return raw.split(",").map((k) => k.trim()).filter(Boolean)
}

export function parseOptionsProviders(options: unknown): Map<string, ProviderConfig> {
  if (!options || typeof options !== "object") return new Map()
  const result = new Map<string, ProviderConfig>()
  const obj = options as Record<string, unknown>
  const providers = obj.providers
  if (!providers || typeof providers !== "object") return new Map()
  for (const [id, cfg] of Object.entries(providers as Record<string, ProviderConfig>)) {
    try {
      const validated = ProviderConfigSchema.parse(cfg)
      result.set(id, validated)
    } catch {
      continue
    }
  }
  return result
}

export function loadProviderConfig(
  providerID: string,
  opts?: unknown,
): ProviderConfig | null {
  const fromEnv = parseEnvProviders().get(providerID)
  if (fromEnv) return fromEnv

  const envKeys = parseEnvKeys(providerID)
  if (envKeys) {
    const fromOpts = parseOptionsProviders(opts).get(providerID)
    const merged = { ...{ keys: envKeys, header: "Authorization", scheme: "Bearer" }, ...fromOpts }
    return ProviderConfigSchema.parse(merged)
  }

  const fromOptsOnly = parseOptionsProviders(opts).get(providerID)
  return fromOptsOnly ?? null
}

export function providerIDs(opts?: unknown): string[] {
  const fromEnv = Array.from(parseEnvProviders().keys())
  const fromOpts = Array.from(parseOptionsProviders(opts).keys())
  return [...new Set([...fromEnv, ...fromOpts])]
}

export function validateProviderConfig(
  providerID: string,
  opts?: unknown,
): ProviderConfig {
  const config = loadProviderConfig(providerID, opts)
  if (!config) throw new Error(`No keys configured for provider "${providerID}"`)
  return config
}

export function envFilePath(directory: string): string {
  const custom = Bun.env.OPENCODE_FAILOVER_ENV_FILE
  if (custom) return path.isAbsolute(custom) ? custom : path.resolve(directory, custom)
  return path.join(directory, ".env")
}

export function readEnvFile(filePath: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!existsSync(filePath)) return result
  const content = readFileSync(filePath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (key) result.set(key, value)
  }
  return result
}

export async function writeEnvKey(filePath: string, key: string, value: string): Promise<void> {
  const lines: string[] = []
  let replaced = false
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith(`${key}=`)) {
        lines.push(`${key}=${value}`)
        replaced = true
      } else {
        lines.push(line)
      }
    }
  }
  if (!replaced) lines.push(`${key}=${value}`)
  await writeFile(filePath, lines.join("\n") + "\n", "utf-8")
}

export async function removeEnvKey(filePath: string, key: string): Promise<boolean> {
  if (!existsSync(filePath)) return false
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const filtered = lines.filter((line) => !line.trim().startsWith(`${key}=`))
  if (filtered.length === lines.length) return false
  await writeFile(filePath, filtered.join("\n"), "utf-8")
  return true
}