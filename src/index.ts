import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { validateProviderConfig, providerIDs } from "./config.ts"
import { KeyPool } from "./state.ts"
import { classify, ErrorAction } from "./classify.ts"

const DEBUG = Boolean(Bun.env.OPENCODE_FAILOVER_DEBUG)

function log(input: PluginInput, message: string, extra?: Record<string, unknown>) {
  input.client.app.log({
    body: {
      service: "opencode-failover",
      level: "info",
      message,
      extra,
    },
  })
}

export default async function failoverPlugin(input: PluginInput, opts?: unknown): Promise<Hooks> {
  const pool = new KeyPool()

  for (const providerID of providerIDs(opts)) {
    const config = validateProviderConfig(providerID, opts)
    pool.register(providerID, config)
  }

  if (DEBUG) log(input, `initialized ${pool.allProviderIDs().length} provider pools`)

  return {
    dispose: async () => {},

    "chat.headers": async (incoming, output) => {
      const providerID = incoming.model.providerID
      const config = validateProviderConfig(providerID, opts)
      const key = pool.pick(providerID)
      const headerValue = `${config.scheme} ${key}`
      output.headers = { ...output.headers, [config.header]: headerValue }
      if (DEBUG) {
        const masked = key.length > 4 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "<short-key>"
        log(input, `injected key ${masked} for ${providerID}`, {
          providerID,
          header: config.header,
          sessionID: incoming.sessionID,
        })
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.error") return
      const properties = (event as Record<string, unknown>).properties as Record<string, unknown> | undefined
      const error = properties?.error as Record<string, unknown> | undefined
      if (!error) return

      const result = classify(error)
      if (result.action === ErrorAction.Ignore) return

      for (const providerID of pool.allProviderIDs()) {
        const keys = pool.status(providerID)
        for (const k of keys) {
          if (k.status === "active" || k.status === "quarantined") {
            const authHeader = `${validateProviderConfig(providerID, opts).scheme} ${k.key}`
            if (containsAuthError(error, authHeader)) {
              if (result.action === ErrorAction.Disable) {
                pool.disable(providerID, k.key, result.reason)
                log(input, `disabled key for ${providerID}: ${result.reason}`, {
                  providerID,
                  reason: result.reason,
                  sessionID: properties?.sessionID,
                })
              }
              if (result.action === ErrorAction.Rotate) {
                pool.quarantine(providerID, k.key, result.retryAfterMs, result.reason)
                log(input, `quarantined key for ${providerID} (${result.retryAfterMs ?? "default"}ms): ${result.reason}`, {
                  providerID,
                  retryAfterMs: result.retryAfterMs,
                  reason: result.reason,
                  sessionID: properties?.sessionID,
                })
              }
              break
            }
          }
        }
      }
    },
  }
}

function containsAuthError(error: Record<string, unknown>, headerValue: string): boolean {
  const body = String(error.responseBody ?? error.body ?? "")
  const message = String(error.message ?? "")
  const combined = `${body} ${message}`.toLowerCase()
  const key = headerValue.toLowerCase()
  return combined.includes(key)
}
