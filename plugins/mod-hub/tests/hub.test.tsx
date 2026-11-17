import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'mod-hub',
  component: 'Pane',
  requestId: 'mod-hub',
  props: {
    title: 'Mod',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const LIST = JSON.stringify([
  { id: 'usage-band@claude-mods', enabled: true },
  { id: 'cyberpunk-look@claude-mods', enabled: false },
  { id: 'mod-hub@claude-mods', enabled: true },
])

test('lists the mods with a toggle each, the hub without one', async ($, on) => {
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', () => ({ value: '/bin/claude' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{"description":"una mod"}' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'usage-band@claude-mods' }))?.text).toContain('Attiva')
    expect((await ui.find({ key: 'cyberpunk-look@claude-mods' }))?.text).toContain('Spenta')
    expect(await ui.find({ key: 'mod-hub@claude-mods' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /2 attive su 3/ }))?.text).toBe('2 attive su 3')
    await ui.unmount()
  }
})

test('minimized to a widget it shows a glance of the count', async ($, on) => {
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', () => ({ value: '/bin/claude' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{}' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /Mod/ }))?.text).toBe('⚙ Mod')
  expect((await ui.find({ type: 'Text', text: /\// }))?.text).toBe('2/3')
  expect(await ui.find({ key: 'usage-band@claude-mods' })).toBeUndefined()
  await ui.unmount()
})

test('the band carries a Mod button that opens the pane, then closes it', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  let isOpen = false
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', () => ({ value: '/bin/claude' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'mod-hub', title: 'Mod', isShown: true, isFocused: true, isPlaced: true }]
      : [],
  }))
  on('ui.open', (_, e) => {
    opened.push((e as { id: string }).id)
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push((e as { id: string }).id)
    isOpen = false
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{}' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'mod-hub',
    component: 'AbovePromptList',
    requestId: 'band',
    surface: 'desktop',
    props: {
      rows: [],
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 3,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 3 },
      view: {},
    },
  })
  expect((await ui.find({ key: 'open-hub' }))?.text).toBe('⚙ Mod')
  await ui.press({ key: 'open-hub' })
  for (let i = 0; i < 200 && opened.length === 0; i++) await Promise.resolve()
  expect(opened).toEqual(['mod-hub'])

  await ui.press({ key: 'open-hub' })
  for (let i = 0; i < 200 && closed.length === 0; i++) await Promise.resolve()
  expect(closed).toEqual(['mod-hub'])
  expect(opened).toHaveLength(1)
  await ui.unmount()
})

test('Ricarica writes /reload-plugins into an empty prompt box', async ($, on) => {
  const ran: string[] = []
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', () => ({ value: '/bin/claude' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    ran.push(e.text)
    return { isFilled: true }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: LIST, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: '{}' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'reload' })
  for (let i = 0; i < 200 && ran.length === 0; i++) await Promise.resolve()
  expect(ran).toContain('/reload-plugins')
  await ui.unmount()
})

test('a press disables an active mod through the CLI', async ($, on) => {
  const runs: string[][] = []
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', () => ({ value: '/bin/claude' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => ({ value: '{}' }))
  on('process.run', (_, e) => {
    const argv = [...(e as { argv: readonly string[] }).argv]
    runs.push(argv)
    return { value: { exitCode: 0, stdout: argv.includes('list') ? LIST : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  // The toggle runs in the background: let its calls settle.
  const isDisabled = () => runs.some(a => a.includes('disable'))
  for (let i = 0; i < 200 && !isDisabled(); i++) await Promise.resolve()

  expect(runs.some(a => a.slice(-3).join(' ') === 'plugin disable usage-band@claude-mods')).toBe(true)
  await ui.unmount()
})
