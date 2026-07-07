import { classify, ErrorAction } from "./classify.ts"

describe("classify", () => {
  it("ignores non-retryable 400", () => {
    const result = classify({
      data: { statusCode: 400, message: "bad request" },
    })
    expect(result.action).toBe(ErrorAction.Ignore)
  })

  it("rotates on 429 with retry-after-ms", () => {
    const result = classify({
      data: { statusCode: 429, responseHeaders: { "retry-after-ms": "3000" } },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
    expect(result.retryAfterMs).toBe(3000)
  })

  it("detects overload even with 429 status", () => {
    const result = classify({
      data: { statusCode: 429, responseBody: "API overloaded" },
    })
    expect(result.action).toBe(ErrorAction.Overload)
  })

  it("disables on 401", () => {
    const result = classify({
      data: { statusCode: 401, message: "unauthorized" },
    })
    expect(result.action).toBe(ErrorAction.Disable)
  })

  it("disables on 403", () => {
    const result = classify({
      data: { statusCode: 403 },
    })
    expect(result.action).toBe(ErrorAction.Disable)
  })

  it("rotates on 502", () => {
    const result = classify({
      data: { statusCode: 502 },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
    expect(result.retryAfterMs).toBe(null)
  })

  it("rotates on retryable 503", () => {
    const result = classify({
      data: { statusCode: 503, isRetryable: true },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
  })

  it("detects overload pattern in response body", () => {
    const result = classify({
      data: { responseBody: JSON.stringify({ error: { code: "context_length_exhausted" } }) },
    })
    expect(result.action).toBe(ErrorAction.Overload)
  })

  it("detects ResourceExhausted server overload", () => {
    const result = classify({
      data: { message: "ResourceExhausted: Worker local total request limit reached (581/48)" },
    })
    expect(result.action).toBe(ErrorAction.Overload)
    expect(result.retryAfterMs).toBe(2000)
  })

  it("detects server is overloaded", () => {
    const result = classify({
      data: { responseBody: "Server is overloaded. Try again later." },
    })
    expect(result.action).toBe(ErrorAction.Overload)
  })

  it("detects service unavailable as overload", () => {
    const result = classify({
      data: { message: "Service unavailable due to high demand" },
    })
    expect(result.action).toBe(ErrorAction.Overload)
  })

  it("detects Anthropic too_many_requests JSON", () => {
    const result = classify({
      data: { responseBody: JSON.stringify({ type: "error", error: { type: "too_many_requests" } }) },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
  })

  it("detects openai rate_limit code", () => {
    const result = classify({
      data: { responseBody: JSON.stringify({ type: "error", error: { code: "rate_limit_exceeded" } }) },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
  })

  it("parses retry-after seconds", () => {
    const result = classify({
      data: { statusCode: 429, responseHeaders: { "retry-after": "4" } },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
    expect(result.retryAfterMs).toBe(4000)
  })

  it("parses retry-after HTTP date", () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    const result = classify({
      data: { statusCode: 429, responseHeaders: { "retry-after": future } },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(result.retryAfterMs).toBeLessThanOrEqual(6000)
  })

  it("parses duration from body message like 'in 4h 26m'", () => {
    const result = classify({
      data: { message: "All 1 account(s) rate-limited for claude. Quota resets in 4h 26m." },
    })
    expect(result.action).toBe(ErrorAction.Overload) // matched "quota"
    expect(result.retryAfterMs).toBe((4 * 3600 + 26 * 60) * 1000)
  })

  it("parses duration from body message like 'resets in 45s'", () => {
    const result = classify({
      data: { message: "Rate limit exceeded. Try again in 45s." },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
    expect(result.retryAfterMs).toBe(45000)
  })

  it("detects rate limit in message string", () => {
    const result = classify({
      data: { message: "Too many requests. Please slow down." },
    })
    expect(result.action).toBe(ErrorAction.Rotate)
  })

  it("ignores unknown non-retryable error", () => {
    const result = classify({
      data: { statusCode: 404, message: "not found" },
    })
    expect(result.action).toBe(ErrorAction.Ignore)
  })
})