import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"

const TEST_DIR = "C:\\Users\\Burak\\AppData\\Local\\Temp\\opencode"
const AUTH_FILE = path.join(TEST_DIR, "auth.json")

function cleanup() {
  if (existsSync(AUTH_FILE)) rmSync(AUTH_FILE, { force: true })
  Bun.env.OPENCODE_CONFIG_DIR = ""
}

describe("auth.ts", () => {
  afterEach(cleanup)

  it("writeAuthKey and read back", async () => {
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })

    const { writeAuthKey } = await import("./lib/auth.ts")
    writeAuthKey("nvidia", "nvapi-xxx")

    expect(existsSync(AUTH_FILE)).toBe(true)
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8"))
    expect(data.nvidia.type).toBe("api")
    expect(data.nvidia.key).toBe("nvapi-xxx")
  })

  it("overwrites existing key", async () => {
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })

    const { writeAuthKey } = await import("./lib/auth.ts")
    writeAuthKey("nvidia", "old")
    writeAuthKey("nvidia", "new")
    
    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8"))
    expect(data.nvidia.key).toBe("new")
  })

  it("removeAuthKey removes entry", async () => {
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })

    const { writeAuthKey, removeAuthKey } = await import("./lib/auth.ts")
    writeAuthKey("nvidia", "nvapi-xxx")
    removeAuthKey("nvidia")

    const exists = existsSync(AUTH_FILE)
    const data = exists ? JSON.parse(readFileSync(AUTH_FILE, "utf-8")) : {}
    expect(data.nvidia).toBeUndefined()
  })

  it("removeAuthKey no-ops for missing", async () => {
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })

    const { writeAuthKey, removeAuthKey } = await import("./lib/auth.ts")
    writeAuthKey("nvidia", "nvapi-xxx")
    removeAuthKey("openrouter")

    const data = JSON.parse(readFileSync(AUTH_FILE, "utf-8"))
    expect(data.nvidia.key).toBe("nvapi-xxx")
  })

  it("creates auth.json if missing", async () => {
    cleanup()
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })

    const { writeAuthKey } = await import("./lib/auth.ts")
    writeAuthKey("openai", "sk-xxx")

    expect(existsSync(AUTH_FILE)).toBe(true)
  })

  it("no-ops remove on missing file", async () => {
    cleanup()
    Bun.env.OPENCODE_CONFIG_DIR = TEST_DIR

    const { removeAuthKey } = await import("./lib/auth.ts")
    removeAuthKey("nvidia")

    expect(existsSync(AUTH_FILE)).toBe(false)
  })
})
