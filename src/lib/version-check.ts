import type { PluginInput } from "@opencode-ai/plugin"

const REGISTRY_URL = "https://registry.npmjs.org/opencode-failover/latest"
const POLL_INTERVAL_MS = 5 * 60 * 1000
const CURRENT_VERSION = "1.0.0"

let lastNotified: string | null = null
let intervalId: ReturnType<typeof setInterval> | null = null

async function checkVersion(input: PluginInput): Promise<void> {
  try {
    const res = await fetch(REGISTRY_URL)
    if (!res.ok) return
    const data = await res.json() as { version?: string }
    const latest = data.version
    if (!latest || latest === CURRENT_VERSION) return
    if (lastNotified === latest) return
    lastNotified = latest
    await input.client.tui.showToast({
      body: {
        message: `opencode-failover: v${latest} available. Update: opencode plugin opencode-failover@latest`,
        variant: "info",
        duration: 10000,
      },
    })
  } catch {
    // network errors are silent
  }
}

export function startVersionChecker(input: PluginInput): void {
  void checkVersion(input)
  intervalId = setInterval(() => void checkVersion(input), POLL_INTERVAL_MS)
}

export function stopVersionChecker(): void {
  if (intervalId) clearInterval(intervalId)
  intervalId = null
}
