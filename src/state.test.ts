import { KeyPool } from "./state.ts"

describe("KeyPool", () => {
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