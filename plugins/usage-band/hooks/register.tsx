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

// Aurora: soft teal to lilac, easing to amber then coral as a window fills.
const AURORA = {
  track: '#dbe2ea',
  tick: '#9aa8b8',
  tickOnFill: '#ffffff',
  calm: ['#5eead4', '#a5b4fc'],
  warm: ['#a5b4fc', '#fcd34d'],
  hot: ['#fcd34d', '#fda4af'],
} as const

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, k) => Math.round(v + (y[k]! - v) * t).toString(16).padStart(2, '0')).join('')
}

function stops(p: number): readonly [string, string] {
  if (p >= 90) return AURORA.hot
  if (p >= 70) return AURORA.warm
  return AURORA.calm
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
  if (d > 0) return `${d}g ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
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
    // The row's own box, not the window: it leaves out the band's marks.
    const cols = e.props.bodyColumns || e.viewport?.columns || 100

    // Two meters share the row: padding 2, gap 4, and 10 cells kept free at the
    // right end for mod-hub's "⚙ Mod" button. Each meter: label 2, bar,
    // percent 4, countdown 9, three 1-cell gaps.
    const per = Math.floor((cols - 2 - 4 - 10) / 2)
    const width = Math.max(8, per - 2 - 4 - 9 - 3)

    // `sections` > 1 draws a hairline at each boundary: the weekly bar gets 7,
    // one per day, so the fill reads against the days gone by.
    const meter = (label: string, w: Window | null, k: string, sections = 1) => {
      const p = w ? Math.max(0, Math.min(100, w.percentUsed)) : 0
      const filled = w && p > 0 ? Math.max(1, Math.round((p / 100) * width)) : 0
      const [from, to] = stops(p)
      const reset = w ? countdown(w.resetsAt, t) : ''
      // One continuous bar: a cell per filled column over the track.
      const continuous = (
        <Box flexDirection="row" width={width} height={1} flexShrink={1} overflow="hidden"
          backgroundColor={AURORA.track}>
          {Array.from({ length: filled }, (_, i) => (
            <Box key={`${k}-${i}`} width={1} height={1} flexShrink={0}
              backgroundColor={mix(from, to, filled <= 1 ? 0 : i / (width - 1))}>
              <Text> </Text>
            </Box>
          ))}
        </Box>
      )

      // Equal sections, each a flex share of the bar (width 0, grow 1: the layout
      // splits the room evenly, never rounded cells), each holding its own part
      // of the fill; a hairline over the left edge of every section but the first
      // marks the boundary.
      const sectioned = (
        <Box flexDirection="row" width={width} height={1} flexShrink={1} overflow="hidden"
          backgroundColor={AURORA.track}>
          {Array.from({ length: sections }, (_, i) => {
            const part = Math.max(0, Math.min(1, (p / 100) * sections - i))
            const color = mix(from, to, Math.min(1, (i + part / 2) / sections))
            return (
              <Box key={`${k}-d${i}`} position="relative" width={0} flexGrow={1} height={1}
                flexShrink={1} overflow="hidden">
                {part > 0 ? (
                  <Box width={`${Math.max(1, Math.round(part * 100))}%`} height={1} backgroundColor={color}>
                    <Text> </Text>
                  </Box>
                ) : (
                  <Text> </Text>
                )}
                {i > 0 ? (
                  <Box position="absolute" left={0} top={0}>
                    <Text color={part > 0 ? AURORA.tickOnFill : AURORA.tick}>▏</Text>
                  </Box>
                ) : null}
              </Box>
            )
          })}
        </Box>
      )

      return (
        <Box key={k} flexDirection="row" gap={1} flexGrow={1} flexShrink={1}>
          <Box flexShrink={0}>
            <Text color="subtle">{label}</Text>
          </Box>
          {sections > 1 ? sectioned : continuous}
          <Box flexShrink={0}>
            <Text bold tabular color={w ? 'text' : 'inactive'}>
              {w ? `${shown(p)}%`.padStart(4) : '   –'}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text dimColor tabular>{(reset ? `· ${reset}` : '').padEnd(9)}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" width="100%" gap={4} paddingX={1} justifyContent="space-between">
        {meter('5h', data.five, 'five', 5)}
        {meter('7g', data.week, 'week', 7)}
      </Box>
    )
  })
}
