import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const TEST_DIR = path.join(Bun.env.TEMP ?? "/tmp", "opencode-failover-auth-test-" + Math.random().toString(36).slice(2, 8))
const AUTH_FILE = path.join(TEST_DIR, ".opencode", "auth.json")

function setupEnv(providerID: string, key: string) {
  const authDir = path.dirname(AUTH_FILE)
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify({ [providerID]: { type: "api", key } }, null, 2))
  Bun.env.HOME = TEST_DIR
  Bun.env.OPENCODE_CONFIG_DIR = ""
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
}

describe("auth.ts", () => {
  beforeEach(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }) })
  afterEach(cleanup)

  it("getNativeAuth returns api entry", () => {
    setupEnv("nvidia", "nvapi-xxx")
    const { getNativeAuth } = require("../src/auth.ts")
    const entry = getNativeAuth("nvidia")
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe("api")
    expect(entry!.key).toBe("nvapi-xxx")
  })

  it("getNativeAuth returns null for oauth entry", () => {
    const authDir = path.dirname(AUTH_FILE)
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
    writeFileSync(AUTH_FILE, JSON.stringify({ nvidia: { type: "oauth", key: "token" } }, null, 2))
    Bun.env.HOME = TEST_DIR
    Bun.env.OPENCODE_CONFIG_DIR = ""
    const { getNativeAuth } = require("../src/auth.ts")
    expect(getNativeAuth("nvidia")).toBeNull()
  })

  it("getNativeAuth returns null for missing provider", () => {
    setupEnv("nvidia", "nvapi-xxx")
    const { getNativeAuth } = require("../src/auth.ts")
    expect(getNativeAuth("openrouter")).toBeNull()
  })

  it("getNativeAuth returns null for empty auth file", () => {
    const authDir = path.dirname(AUTH_FILE)
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
    writeFileSync(AUTH_FILE, "{}")
    Bun.env.HOME = TEST_DIR
    Bun.env.OPENCODE_CONFIG_DIR = ""
    const { getNativeAuth } = require("../src/auth.ts")
    expect(getNativeAuth("nvidia")).toBeNull()
  })

  it("removeNativeAuth removes api entry and returns it", () => {
    setupEnv("nvidia", "nvapi-xxx")
    const { removeNativeAuth, getNativeAuth } = require("../src/auth.ts")
    const removed = removeNativeAuth("nvidia")
    expect(removed).not.toBeNull()
    expect(removed!.key).toBe("nvapi-xxx")
    expect(getNativeAuth("nvidia")).toBeNull()
  })

  it("removeNativeAuth returns null for missing provider", () => {
    setupEnv("nvidia", "nvapi-xxx")
    const { removeNativeAuth } = require("../src/auth.ts")
    expect(removeNativeAuth("openrouter")).toBeNull()
  })

  it("restoreNativeAuth restores a backed-up entry", () => {
    setupEnv("nvidia", "nvapi-xxx")
    const { removeNativeAuth, restoreNativeAuth, getNativeAuth } = require("../src/auth.ts")
    const removed = removeNativeAuth("nvidia")
    expect(getNativeAuth("nvidia")).toBeNull()
    restoreNativeAuth("nvidia", removed!)
    const restored = getNativeAuth("nvidia")
    expect(restored).not.toBeNull()
    expect(restored!.key).toBe("nvapi-xxx")
  })

  it("removeNativeAuth does not remove oauth entries", () => {
    const authDir = path.dirname(AUTH_FILE)
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
    writeFileSync(AUTH_FILE, JSON.stringify({ nvidia: { type: "oauth", key: "token" } }, null, 2))
    Bun.env.HOME = TEST_DIR
    Bun.env.OPENCODE_CONFIG_DIR = ""
    const { removeNativeAuth } = require("../src/auth.ts")
    expect(removeNativeAuth("nvidia")).toBeNull()
  })

  it("handles invalid JSON gracefully", () => {
    const authDir = path.dirname(AUTH_FILE)
    if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true })
    writeFileSync(AUTH_FILE, "not json")
    Bun.env.HOME = TEST_DIR
    Bun.env.OPENCODE_CONFIG_DIR = ""
    const { getNativeAuth, removeNativeAuth } = require("../src/auth.ts")
    expect(getNativeAuth("nvidia")).toBeNull()
    expect(removeNativeAuth("nvidia")).toBeNull()
  })

  it("handles missing auth.json gracefully", () => {
    Bun.env.HOME = "/nonexistent/path"
    Bun.env.OPENCODE_CONFIG_DIR = ""
    const { getNativeAuth, removeNativeAuth } = require("../src/auth.ts")
    expect(getNativeAuth("nvidia")).toBeNull()
    expect(removeNativeAuth("nvidia")).toBeNull()
  })
})

describe("KeyPool auth backup", () => {
  it("backupAuth and restoreAuth cycle", () => {
    const { KeyPool } = require("../src/state.ts")
    const pool = new KeyPool()

    expect(pool.hasAuthBackup("nvidia")).toBe(false)
    expect(pool.restoreAuth("nvidia")).toBeNull()

    pool.backupAuth("nvidia", { type: "api", key: "nvapi-xxx" })
    expect(pool.hasAuthBackup("nvidia")).toBe(true)

    const restored = pool.restoreAuth("nvidia")
    expect(restored).not.toBeNull()
    expect(restored!.key).toBe("nvapi-xxx")
    expect(pool.hasAuthBackup("nvidia")).toBe(false)
  })

  it("backupAuth does not overwrite existing backup", () => {
    const { KeyPool } = require("../src/state.ts")
    const pool = new KeyPool()
    pool.backupAuth("nvidia", { type: "api", key: "nvapi-first" })
    pool.backupAuth("nvidia", { type: "api", key: "nvapi-second" })
    const restored = pool.restoreAuth("nvidia")
    expect(restored!.key).toBe("nvapi-first")
  })
})