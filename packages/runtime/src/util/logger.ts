// Structured debug logger for legion runtime. Disabled by default; enable
// per-process with LEGION_DEBUG=1. Output goes to stderr so it does not
// interfere with stdout (which carries CLI output / server logs).
//
// Usage:
//   import { debugLog } from '@legion/runtime/util/logger'
//   debugLog('delegate.start', { role: 'reviewer', edgeType: 'reviews' })
//
// Each entry is one line: ISO timestamp, tag, JSON payload.

const ENABLED =
  process.env['LEGION_DEBUG'] === '1' ||
  process.env['LEGION_DEBUG'] === 'true' ||
  process.env['LEGION_DEBUG'] === 'on'

export function debugEnabled(): boolean {
  return ENABLED
}

export function debugLog(tag: string, payload: Record<string, unknown> = {}): void {
  if (!ENABLED) return
  const ts = new Date().toISOString()
  // Truncate any long string fields for readability.
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    safe[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v
  }
  // eslint-disable-next-line no-console
  console.error(`[${ts}] [legion:${tag}]`, JSON.stringify(safe))
}
