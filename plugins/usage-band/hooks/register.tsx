import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limits, Window } from '../types'

const EMPTY: Limits = { five: null, week: null }
const STORE_KEY = 'lastLimits'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, EMPTY)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

function toLimits(rows: SessionRateLimit[]): Limits {
  const pick = (kind: string): Window | null => {
    const r = rows.find(x => x.kind === kind)
    return r ? { percentUsed: r.percentUsed, resetsAt: r.resetsAt } : null
  }
  return { five: pick('five_hour'), week: pick('seven_day') }
}

async function save($: EngineInterface, rows: SessionRateLimit[]) {
  const next = toLimits(rows)
  if (!next.five && !next.week) return
  await update($, limits, () => next)
  await $.store.set(STORE_KEY, next)
}

// Neon HUD palette (raw colors: the look is the mod's own, whatever the theme).
const NEON = {
  bg: '#0d0918',
  track: '#2a1840',
  cyan: '#00f0ff',
  magenta: '#ff2fd1',
  yellow: '#f9f002',
  red: '#ff2a6d',
  dim: '#8a7fb0',
  text: '#e9fbff',
}

function hex(n: number): string {
  return Math.round(n).toString(16).padStart(2, '0')
}

// Color along cyan -> magenta for segment i of n; hot when the window is nearly spent.
function segColor(i: number, n: number, p: number): string {
  if (p >= 90) return NEON.red
  if (p >= 70) return NEON.yellow
  const t = n <= 1 ? 0 : i / (n - 1)
  const a = [0x00, 0xf0, 0xff]
  const b = [0xff, 0x2f, 0xd1]
  return '#' + a.map((v, k) => hex(v + ((b[k] ?? 0) - v) * t)).join('')
}

function accent(p: number): string {
  if (p >= 90) return NEON.red
  if (p >= 70) return NEON.yellow
  return NEON.magenta
}

// The official usage page rounds up: 10.2% used reads as 11%.
function shown(p: number): number {
  return Math.min(100, Math.ceil(p - 1e-9))
}

async function refresh($: EngineInterface) {
  try {
    await save($, (await $.session.usage()).rateLimits)
  } catch {}
}

function countdown(resetsAt: string | undefined, t: number): string {
  if (!resetsAt || !t) return ''
  const ms = Date.parse(resetsAt) - t
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'reset'
  const min = Math.floor(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `T-${d}g${String(h).padStart(2, '0')}h`
  if (h > 0) return `T-${h}h${String(m).padStart(2, '0')}m`
  return `T-${m}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    const stored = (await $.store.get(STORE_KEY)) as Limits | undefined
    if (stored && (stored.five || stored.week)) {
      await update($, limits, () => stored)
    }
    await refresh($)

    await update($, now, () => Date.now())
    $.clock.every(30_000, () => {
      void refresh($)
      void $.clock.now().then(t => update($, now, () => t))
    })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await save($, e.rateLimits)
    await update($, now, () => Date.now())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, limits)
    const t = await read($, now)
    const cols = e.viewport?.columns ?? 100

    // Two meters share the row: padding 2, gap 4, a 6-cell margin (the desktop
    // band is a little narrower than its reported columns). Each meter: label 4,
    // bar, percent 4, countdown 8, three 1-cell gaps.
    const per = Math.floor((cols - 2 - 4 - 6) / 2)
    const barCells = Math.max(8, per - 4 - 4 - 8 - 3)
    // Segments two cells wide with a one-cell gap: a HUD gauge.
    const segs = Math.max(3, Math.floor((barCells + 1) / 3))

    const meter = (label: string, w: Window | null, k: string) => {
      const p = w ? Math.max(0, Math.min(100, w.percentUsed)) : 0
      const lit = w && p > 0 ? Math.max(1, Math.round((p / 100) * segs)) : 0
      const reset = w ? countdown(w.resetsAt, t) : ''
      return (
        <Box key={k} flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
          <Box flexShrink={0}>
            <Text bold mono color={NEON.cyan}>{`[${label}]`}</Text>
          </Box>
          <Box flexDirection="row" columnGap={1} flexShrink={1} overflow="hidden">
            {Array.from({ length: segs }, (_, i) => (
              <Box key={`${k}-${i}`} width={2} height={1} flexShrink={0}
                backgroundColor={i < lit ? segColor(i, segs, p) : NEON.track}>
                <Text>{'  '}</Text>
              </Box>
            ))}
          </Box>
          <Box flexShrink={0}>
            <Text bold mono tabular color={w ? accent(p) : NEON.dim}>
              {w ? `${shown(p)}%`.padStart(4) : ' ---'}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text mono tabular color={NEON.dim}>{reset.padEnd(8)}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" width="100%" gap={4} paddingX={1}
        backgroundColor={NEON.bg} justifyContent="space-between">
        {meter('5H', data.five, 'five')}
        {meter('7G', data.week, 'week')}
      </Box>
    )
  })
}
