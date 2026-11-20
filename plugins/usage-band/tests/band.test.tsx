import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  requestId: 'usage-band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-17T10:00:00Z')

test('both meters draw with percent and reset, on every surface', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    if (key === 'limits') {
      return {
        value: {
          value: {
            five: { percentUsed: 47.3, resetsAt: '2026-11-17T12:13:00Z' },
            week: { percentUsed: 92, resetsAt: '2026-11-20T14:00:00Z' },
          },
          version: 1,
        },
      }
    }
    return { value: { value: NOW, version: 1 } }
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /48%/ }))?.text).toContain('48%')
    expect((await ui.find({ type: 'Text', text: /92%/ }))?.text).toContain('92%')
    expect((await ui.find({ type: 'Text', text: /2h 13m/ }))?.text).toContain('2h 13m')
    expect((await ui.find({ type: 'Text', text: /3g 4h/ }))?.text).toContain('3g 4h')
    await ui.unmount()
  }
})

test('with no reading yet the bars still show, empty', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^5h$/ }))?.text).toBe('5h')
  expect((await ui.find({ type: 'Text', text: /^7g$/ }))?.text).toBe('7g')
  await ui.unmount()
})

test('the weekly bar carries six day hairlines, the 5-hour bar four hour ones', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    if (key === 'limits') {
      return {
        value: {
          value: {
            five: { percentUsed: 40, resetsAt: '2026-11-17T12:13:00Z' },
            week: { percentUsed: 30, resetsAt: '2026-11-20T14:00:00Z' },
          },
          version: 1,
        },
      }
    }
    return { value: { value: NOW, version: 1 } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Text', text: '▏' })).toHaveLength(10)
  await ui.unmount()
})

test('under each bar a hairline holds the time left against the right edge', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as { key: string }).key
    if (key === 'limits') {
      return {
        value: {
          value: {
            five: { percentUsed: 47.3, resetsAt: '2026-11-17T12:13:00Z' },
            week: { percentUsed: 92, resetsAt: '2026-11-20T14:00:00Z' },
          },
          version: 1,
        },
      }
    }
    return { value: { value: NOW, version: 1 } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // One glyph for both halves, so a font swap can never stretch the spent side
  // and clip the fill: spent then left, for the 5-hour bar then the weekly one.
  // Each run is overfilled twice its cells and cut by its Box, never by an ellipsis.
  const hair = await ui.findAll({ type: 'Text', text: /^━+$/ })
  expect(hair.map(x => x.text.length)).toEqual([38, 30, 38, 30])
  expect(hair.every(x => (x.props as { wrap?: string }).wrap === 'wrap')).toBe(true)
  await ui.unmount()
})
