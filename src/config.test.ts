import { describe, it, expect, beforeEach } from "bun:test"
import { discoverEnvProviders, providerIDs } from "./config.ts"

describe("discoverEnvProviders", () => {
  beforeEach(() => {
    delete Bun.env["NVIDIA_API_KEYS"]
    delete Bun.env["OPENROUTER_API_KEYS"]
    delete Bun.env["OPENCODE_FAILOVER_PROVIDERS"]
  })

  it("discovers providers from <ID>_API_KEYS env vars", () => {
    Bun.env["NVIDIA_API_KEYS"] = "key1,key2"
    const result = discoverEnvProviders()
    expect(result.size).toBe(1)
    expect(result.get("nvidia")?.keys).toEqual(["key1", "key2"])
  })

  it("discovers multiple providers", () => {
    Bun.env["NVIDIA_API_KEYS"] = "k1"
    Bun.env["OPENROUTER_API_KEYS"] = "k2"
    const result = discoverEnvProviders()
    expect(result.size).toBe(2)
    expect(result.get("nvidia")?.keys).toEqual(["k1"])
    expect(result.get("openrouter")?.keys).toEqual(["k2"])
  })

  it("ignores empty keys", () => {
    Bun.env["NVIDIA_API_KEYS"] = ""
    const result = discoverEnvProviders()
    expect(result.size).toBe(0)
  })

  it("ignores OPENCODE_FAILOVER_PROVIDERS key", () => {
    Bun.env["OPENCODE_FAILOVER_PROVIDERS"] = "something"
    const result = discoverEnvProviders()
    expect(result.size).toBe(0)
  })

  it("defaults to Bearer Authorization scheme", () => {
    Bun.env["NVIDIA_API_KEYS"] = "key1"
    const result = discoverEnvProviders()
    const config = result.get("nvidia")
    expect(config?.header).toBe("Authorization")
    expect(config?.scheme).toBe("Bearer")
  })

  it("trims whitespace from keys", () => {
    Bun.env["NVIDIA_API_KEYS"] = " key1 , key2 "
    const result = discoverEnvProviders()
    expect(result.get("nvidia")?.keys).toEqual(["key1", "key2"])
  })
})

describe("providerIDs includes discovered env providers", () => {
  beforeEach(() => {
    delete Bun.env["NVIDIA_API_KEYS"]
    delete Bun.env["OPENCODE_FAILOVER_PROVIDERS"]
  })

  it("includes discovered providers in the list", () => {
    Bun.env["NVIDIA_API_KEYS"] = "k1"
    const ids = providerIDs()
    expect(ids).toContain("nvidia")
  })
})
