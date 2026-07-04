export enum ErrorAction {
  Rotate = "rotate",
  Disable = "disable",
  Ignore = "ignore",
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

  if (status === 429 || is429Overloaded(body, message)) {
    return { action: ErrorAction.Rotate, retryAfterMs, reason: `Rate limited (${status})` }
  }

  if (status === 401 || status === 403 || status === 402) {
    return { action: ErrorAction.Disable, retryAfterMs: null, reason: `Auth/billing failed (${status})` }
  }

  if (status >= 500 && status < 600) {
    return { action: ErrorAction.Rotate, retryAfterMs: null, reason: `Server error (${status})` }
  }

  if (isRetryable && status >= 400) {
    return { action: ErrorAction.Rotate, retryAfterMs, reason: `Retryable error (${status})` }
  }

  if (hasRateLimitPattern(body, message)) {
    return { action: ErrorAction.Rotate, retryAfterMs, reason: "Rate limit pattern detected" }
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

function is429Overloaded(body: string, message: string): boolean {
  const lower = body.toLowerCase() + message.toLowerCase()
  return lower.includes("overloaded") || lower.includes("capacity") || lower.includes("quota")
}

function hasRateLimitPattern(body: string, message: string): boolean {
  const lower = body.toLowerCase() + message.toLowerCase()
  const patterns = [
    "rate increased too quickly",
    "rate limit",
    "too many requests",
    "exhausted",
    "unavailable",
    "too_many_requests",
    "rate_limit",
  ]
  for (const p of patterns) {
    if (lower.includes(p)) return true
  }

  try {
    const json = JSON.parse(body)
    if (json?.type === "error" && json?.error?.type === "too_many_requests") return true
    const code = typeof json?.code === "string" ? json.code : ""
    if (code.includes("exhausted") || code.includes("unavailable")) return true
    if (json?.type === "error" && typeof json?.error?.code === "string" && json.error.code.includes("rate_limit")) return true
  } catch {
  }

  return false
}