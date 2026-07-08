import type { KeyPool } from "./state.ts"
import { classify, ErrorAction } from "./classify.ts"
import { writeAuthKey } from "./auth.ts"

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529])
const MAX_RETRIES = 3
const AUTH_HEADERS = ["authorization", "x-api-key", "api-key", "x-goog-api-key"]

type ProviderMeta = { header: string; scheme: string }
const providers = new Map<string, ProviderMeta>()

let _original: typeof fetch | null = null
let _pool: KeyPool | null = null
let _input: any = null
let _installed = false
type FetchArgs = Parameters<typeof fetch>

function toast(message: string, variant: string) {
  try { _input?.client?.tui?.showToast({ body: { message, variant, duration: 6000 } }) } catch {}
}

function retryMs(headers: Headers): number {
  const raw = headers.get("retry-after")
  if (!raw) return 60_000
  const n = Number(raw)
  if (Number.isFinite(n)) return Math.max(1000, n * 1000)
  const d = Date.parse(raw)
  if (Number.isFinite(d)) return Math.max(1000, d - Date.now())
  return 60_000
}

function readHeaders(init?: RequestInit): Record<string, string> {
  const result: Record<string, string> = {}
  if (!init?.headers) return result
  if (init.headers instanceof Headers) {
    init.headers.forEach((v, k) => { result[k.toLowerCase()] = v })
  } else if (Array.isArray(init.headers)) {
    for (const [k, v] of init.headers) {
      if (k !== undefined) result[k.toLowerCase()] = String(v)
    }
  } else {
    for (const [k, v] of Object.entries(init.headers)) result[k.toLowerCase()] = String(v)
  }
  return result
}

function findAuthValue(hdrs: Record<string, string>): string {
  for (const name of AUTH_HEADERS) {
    if (hdrs[name]) return hdrs[name]
  }
  return ""
}

function matchPoolKey(authValue: string): { providerID: string; key: string; meta: ProviderMeta } | null {
  if (!_pool || !authValue) return null
  for (const [providerID, meta] of providers) {
    const keys = _pool.status(providerID)
    for (const k of keys) {
      if (authValue === k.key || authValue.endsWith(" " + k.key) || authValue.endsWith("=" + k.key)) {
        return { providerID, key: k.key, meta }
      }
      if (k.key.length > 10 && authValue.includes(k.key)) {
        return { providerID, key: k.key, meta }
      }
    }
  }
  return null
}

function applyAuth(init: RequestInit | undefined, meta: ProviderMeta, key: string): RequestInit {
  const hdrs = new Headers()
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => hdrs.set(k, v))
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        if (k !== undefined) hdrs.set(k, String(v))
      }
    } else {
      for (const [k, v] of Object.entries(init.headers)) hdrs.set(k, String(v))
    }
  }
  const value = meta.scheme ? `${meta.scheme} ${key}` : key
  let found = false
  for (const name of AUTH_HEADERS) {
    if (hdrs.has(name)) { hdrs.set(name, value); found = true; break }
  }
  if (!found) hdrs.set(meta.header, value)
  return { ...init, headers: hdrs }
}

export function registerProvider(providerID: string, meta: ProviderMeta): void {
  providers.set(providerID, meta)
}

export function installFetchPatch(input: any, pool: KeyPool): void {
  if (_installed) return
  _installed = true
  _pool = pool
  _input = input
  _original = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (req: FetchArgs[0], init?: FetchArgs[1]) => {
    if (!_original || !_pool) return _original!(req, init)

    const hdrs = readHeaders(init)
    const authValue = findAuthValue(hdrs)
    const match = matchPoolKey(authValue)
    if (!match) return _original(req, init)

    const { providerID, meta } = match
    let key = _pool.pick(providerID)

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const newInit = applyAuth(init, meta, key)
      const res = await _original(req, newInit)

      if (!RETRYABLE.has(res.status)) {
        let body = ""
        try { body = await res.clone().text() } catch {}
        const result = classify({ statusCode: res.status, responseBody: body, message: body.slice(0, 200) })
        if (result.action !== ErrorAction.Overload) return res
        if (attempt >= MAX_RETRIES - 1) return res

        const next = _pool.pick(providerID)
        try { writeAuthKey(providerID, next) } catch {}
        const nextMasked = next.length > 7 ? `${next.slice(0, 4)}...${next.slice(-3)}` : "<key>"
        toast(`opencode-failover: [${providerID}] server overload. Switching to ${nextMasked} (2s backoff).`, "warning")
        key = next
        continue
      }
      if (attempt >= MAX_RETRIES - 1) return res

      let body = ""
      try { body = await res.clone().text() } catch {}

      const error = { statusCode: res.status, responseBody: body, message: body.slice(0, 200) }
      const result = classify(error)
      if (result.action === ErrorAction.Ignore) return res

      const masked = key.length > 7 ? `${key.slice(0, 4)}...${key.slice(-3)}` : "<key>"

      if (result.action === ErrorAction.Overload) {
        const next = _pool.pick(providerID)
        try { writeAuthKey(providerID, next) } catch {}
        const nextMasked = next.length > 7 ? `${next.slice(0, 4)}...${next.slice(-3)}` : "<key>"
        toast(`opencode-failover: [${providerID}] server overload. Switching to ${nextMasked} (2s backoff).`, "warning")
        key = next
        continue
      }

      if (result.action === ErrorAction.Disable) {
        _pool.disable(providerID, key, result.reason)
        key = _pool.pick(providerID)
        try { writeAuthKey(providerID, key) } catch {}
        toast(`opencode-failover: ${providerID} key ${masked} disabled — ${result.reason}`, "error")
        continue
      }

      if (result.action === ErrorAction.Rotate) {
        const delay = result.retryAfterMs || retryMs(res.headers)
        if (delay < 10_000) {
          const next = _pool.pick(providerID)
          try { writeAuthKey(providerID, next) } catch {}
          const nextMasked = next.length > 7 ? `${next.slice(0, 4)}...${next.slice(-3)}` : "<key>"
          toast(`opencode-failover: [${providerID}] server overload. Switching to ${nextMasked} (2s backoff).`, "warning")
          key = next
          continue
        }
        _pool.quarantine(providerID, key, delay, result.reason)
        const next = _pool.pick(providerID)
        try { writeAuthKey(providerID, next) } catch {}
        const nextMasked = next.length > 7 ? `${next.slice(0, 4)}...${next.slice(-3)}` : "<key>"
        toast(`opencode-failover: [${providerID}] Key ${masked} quarantined. Switching to ${nextMasked} (${Math.ceil(delay / 1000)}s).`, "warning")
        key = next
        continue
      }
    }

    throw new Error("opencode-failover: retry loop exhausted")
  }) as typeof fetch
}

export function uninstallFetchPatch(): void {
  if (_original) { globalThis.fetch = _original; _original = null }
  _installed = false
  _pool = null
  _input = null
  providers.clear()
}
