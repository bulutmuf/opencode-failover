export enum ErrorAction {
  Rotate = "rotate",
  Disable = "disable",
  Ignore = "ignore",
  Overload = "overload",
}

export interface ClassifierResult {
  action: ErrorAction
  retryAfterMs: number | null
  reason: string
}

interface APIError {
  statusCode?: number
  responseHeaders?: Record<string, string | null>
  responseBody?: string
  message?: string
  isRetryable?: boolean
}

export function classify(raw: unknown): ClassifierResult {
  const error = (raw as Record<string, unknown>).data ?? raw
  const status = Number((error as APIError).statusCode ?? (error as Record<string, unknown>).status ?? 0)
  const headers = (error as APIError).responseHeaders ?? (error as Record<string, unknown>).headers ?? {}
  const body = String((error as APIError).responseBody ?? (error as Record<string, unknown>).body ?? "")
  const message = String((error as APIError).message ?? (error as Record<string, unknown>).message ?? "")
  const isRetryable = Boolean((error as APIError).isRetryable ?? (error as Record<string, unknown>).isRetryable ?? false)

  const retryAfterMs = parseRetryAfter(headers as Record<string, string>)

  if (hasOverloadPattern(body, message)) {
    return { action: ErrorAction.Overload, retryAfterMs: 2000, reason: `Server overload — pattern: ${detectOverloadPattern(body, message)}` }
  }

  if (status === 429) {
    return { action: ErrorAction.Rotate, retryAfterMs, reason: `Rate limited — HTTP 429` }
  }

  if (status === 401 || status === 403 || status === 402) {
    const label = status === 402 ? "Payment required" : status === 401 ? "Authentication failed" : "Forbidden"
    return { action: ErrorAction.Disable, retryAfterMs: null, reason: `${label} — HTTP ${status}` }
  }

  if (status >= 500 && status < 600) {
    return { action: ErrorAction.Rotate, retryAfterMs: null, reason: `Server error — HTTP ${status}` }
  }

  if (hasRateLimitPattern(body, message)) {
    return { action: ErrorAction.Rotate, retryAfterMs, reason: `Rate limit — pattern: ${detectPattern(body, message)}` }
  }

  return { action: ErrorAction.Ignore, retryAfterMs: null, reason: "Non-retryable error" }
}

function parseRetryAfter(headers: Record<string, string>): number | null {
  const retryAfterMs = headers["retry-after-ms"]
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs)
    if (!Number.isNaN(parsed) && parsed > 0) return Math.ceil(parsed)
  }
  const retryAfter = headers["retry-after"]
  if (retryAfter) {
    const parsed = Number.parseFloat(retryAfter)
    if (!Number.isNaN(parsed) && parsed > 0) return Math.ceil(parsed * 1000)
    const dateParsed = Date.parse(retryAfter)
    if (!Number.isNaN(dateParsed)) {
      const ms = dateParsed - Date.now()
      if (ms > 0) return Math.ceil(ms)
    }
  }
  return null
}

function hasOverloadPattern(body: string, message: string): boolean {
  return detectOverloadPattern(body, message) !== null
}

function detectOverloadPattern(body: string, message: string): string | null {
  const lower = body.toLowerCase() + message.toLowerCase()
  const patterns = [
    "resource exhausted",
    "resource_exhausted",
    "exhausted",
    "worker local total request limit",
    "server is overloaded",
    "overloaded",
    "service unavailable",
    "capacity",
    "quota",
  ]
  for (const p of patterns) {
    if (lower.includes(p)) return `"${p}"`
  }
  return null
}

function hasRateLimitPattern(body: string, message: string): boolean {
  return detectPattern(body, message) !== null
}

function detectPattern(body: string, message: string): string | null {
  const lower = body.toLowerCase() + message.toLowerCase()
  const patterns = [
    "rate increased too quickly",
    "rate limit",
    "too many requests",
    "unavailable",
    "too_many_requests",
    "rate_limit",
  ]
  for (const p of patterns) {
    if (lower.includes(p)) return `"${p}"`
  }

  try {
    const json = JSON.parse(body)
    if (json?.type === "error" && json?.error?.type === "too_many_requests") return `"too_many_requests" (json.type)`
    const code = typeof json?.code === "string" ? json.code : ""
    if (code.includes("unavailable")) return `"${code}" (json.code)`
    if (json?.type === "error" && typeof json?.error?.code === "string" && json.error.code.includes("rate_limit")) return `"${json.error.code}" (json.error.code)`
  } catch {
  }

  return null
}