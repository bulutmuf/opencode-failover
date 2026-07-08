import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { KeyPool } from "./lib/state.ts"

const TEST_DIR = "C:\\Users\\Burak\\AppData\\Local\\Temp\\opencode_state_test"

describe("KeyPool", () => {
  beforeAll(() => {
    Bun.env.OPENCODE_FAILOVER_TEST_DIR = TEST_DIR
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterAll(() => {
    delete Bun.env.OPENCODE_FAILOVER_TEST_DIR
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("rotates keys round-robin by weight", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
      weight: { "key-a": 2, "key-b": 1 },
    })

    const picks: string[] = []
    for (let i = 0; i < 6; i++) picks.push(pool.pick("test"))

    const aCount = picks.filter((k) => k === "key-a").length
    const bCount = picks.filter((k) => k === "key-b").length
    expect(aCount).toBe(4)
    expect(bCount).toBe(2)
  })

  it("quarantines rate-limited key and picks another", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b", "key-c"],
      header: "Authorization",
      scheme: "Bearer",
    })

    const before = pool.pick("test")
    pool.quarantine("test", before, null, "429 rate limit")
    const after = pool.pick("test")
    expect(after).not.toBe(before)
  })

  it("disables permanently", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.disable("test", "key-a", "401 unauthorized")
    const picked = pool.pick("test")
    expect(picked).toBe("key-b")

    for (let i = 0; i < 5; i++) {
      expect(pool.pick("test")).toBe("key-b")
    }
  })

  it("returns last quarantined key when all keys are quarantined", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.quarantine("test", "key-a", null, "400 rate limit")
    pool.quarantine("test", "key-b", null, "400 rate limit")
    const picked = pool.pick("test")
    expect(picked).toBeDefined()
    expect(["key-a", "key-b"]).toContain(picked)
  })

  it("does not reactivate disabled keys when all keys are disabled", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.disable("test", "key-a", "401")
    pool.disable("test", "key-b", "403")

    expect(() => pool.pick("test")).toThrow('No active keys available for provider "test"')
    expect(pool.status("test").map((k) => k.status)).toEqual(["disabled", "disabled"])
  })

  it("uses quarantined keys before disabled keys when no active keys remain", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b", "key-c"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.disable("test", "key-a", "401")
    pool.quarantine("test", "key-b", null, "429")
    pool.quarantine("test", "key-c", null, "429")

    expect(["key-b", "key-c"]).toContain(pool.pick("test"))
    expect(pool.status("test").find((k) => k.key === "key-a")!.status).toBe("disabled")
  })

  it("unquarantees keys after retryAfterMs expires", async () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.quarantine("test", "key-a", 500, "429")
    pool.quarantine("test", "key-b", 500, "429")

    await new Promise((r) => setTimeout(r, 600))

    const picked = pool.pick("test")
    expect(pool.status("test").filter((k) => k.status === "active").length).toBeGreaterThanOrEqual(1)
  })

  it("uses retryAfterMs as the quarantine duration", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    const before = Date.now()
    pool.quarantine("test", "key-a", 2_500, "429 retry-after")
    const until = pool.status("test").find((k) => k.key === "key-a")!.quarantinedUntil

    expect(until - before).toBeGreaterThanOrEqual(2_500)
    expect(until - before).toBeLessThan(5_000)
  })

  it("exponential backoff on repeat quarantine", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.quarantine("test", "key-a", null, "429")
    const q1 = pool.status("test").find((k) => k.key === "key-a")!.quarantinedUntil
    pool.quarantine("test", "key-a", null, "429")
    const q2 = pool.status("test").find((k) => k.key === "key-a")!.quarantinedUntil
    expect(q2 - q1).toBeGreaterThan(59_990)
  })

  it("allocates no index drift from disabling", () => {
    const pool = new KeyPool()
    pool.register("test", {
      keys: ["key-a", "key-b", "key-c"],
      header: "Authorization",
      scheme: "Bearer",
    })

    pool.disable("test", "key-b", "401")

    const picks = new Set<string>()
    for (let i = 0; i < 10; i++) picks.add(pool.pick("test"))
    expect(picks.has("key-b")).toBe(false)
  })
})
