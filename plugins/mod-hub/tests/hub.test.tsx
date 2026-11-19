import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'mod-hub',
  component: 'Pane',
  requestId: 'mod-hub',
  props: {
    title: 'Mod, connettori e skill',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const LOCAL = '/local'
const PROFILE = `${LOCAL}/Claude-Data/claude_abc`
// The binary the desktop app carries: not on PATH, found by listing.
const EXE = `${PROFILE}/claude-code/2.1.326/d31a4581af92/claude.exe`

const TREE: Record<string, { name: string; kind: string }[]> = {
  [`${LOCAL}/Claude-Data`]: [
    { name: 'README.txt', kind: 'file' },
    { name: 'claude_abc', kind: 'dir' },
  ],
  [`${PROFILE}/claude-code`]: [{ name: '2.1.326', kind: 'dir' }],
  [`${PROFILE}/claude-code/2.1.326`]: [{ name: 'd31a4581af92', kind: 'dir' }],
}
const HOME = '/home/u'
const CATEGORIES = `${HOME}/.claude/mod-hub/categorie.json`
const INSTALLED_FILE = `${HOME}/.claude/plugins/installed_plugins.json`
const SETTINGS_FILE = `${HOME}/.claude/settings.json`

// What Claude Code writes when a mod is installed: the hub reads these two
// files, never the `claude` CLI (not on PATH under the desktop app).
const INSTALLED = JSON.stringify({
  version: 2,
  plugins: {
    'usage-band@claude-mods': [{ scope: 'user', installPath: `${HOME}/.claude/plugins/cache/claude-mods/usage-band/0.1.0` }],
    'cyberpunk-look@claude-mods': [{ scope: 'user', installPath: `${HOME}/.claude/plugins/cache/claude-mods/cyberpunk-look/0.1.0` }],
    'mod-hub@claude-mods': [{ scope: 'user', installPath: `${HOME}/.claude/plugins/cache/claude-mods/mod-hub/0.1.0` }],
  },
})

const SETTINGS = JSON.stringify({
  enabledPlugins: { 'usage-band@claude-mods': true, 'mod-hub@claude-mods': true },
  extraKnownMarketplaces: { 'claude-mods': { source: { source: 'directory', path: '/repo' } } },
})

// What the app's session_connectors_status answers: claude.ai connectors and
// the session's servers; disabled local servers are missing from it.
const SERVERS = JSON.stringify({
  servers: [
    { name: 'Claude Docs', kind: 'connector', status: 'connected', tool_count: 8 },
    { name: 'Excalidraw', kind: 'connector', status: 'disabled' },
    { name: 'scheduled-tasks', kind: 'other', status: 'connected', tool_count: 6 },
  ],
})

// The app's own config: local servers, their secrets beside them.
const DESKTOP_CONFIG = JSON.stringify({
  mcpServers: {
    audiovault: { command: 'node', env: { TOKEN: 'secret' } },
    'home-assistant': { command: 'uvx' },
    'jelly-stat': { command: 'node' },
  },
})

// Tools of the session: Claude in Chrome and one local server switched on.
const TOOLS = ['mcp__claude-in-chrome__navigate', 'mcp__claude-in-chrome__computer', 'mcp__jelly-stat__search_movies', 'Bash']

const COMMANDS = [
  { name: 'xal-forge', description: 'Genera scenari XAL. Da usare quando serve.', source: 'user' },
  { name: 'brand', description: 'Voce del brand.', source: 'user' },
  { name: 'deploy', description: 'Rilascia il progetto.', source: 'user' },
  { name: 'anthropic-skills:pdf', description: 'Lavora con i PDF.', source: 'plugin', plugin: 'anthropic-skills' },
  { name: 'mods', description: 'Apre il pannello', source: 'plugin', plugin: 'mod-hub' },
  { name: 'tally', description: 'Comando di una mod', source: 'plugin', plugin: 'usage-band' },
  { name: 'help', description: 'Aiuto', source: 'builtin' },
]

type Seen = {
  runs: string[][]
  writes: { path: string; text: string }[]
  mcp: { tool: string; args: Record<string, unknown> }[]
  prompts: string[]
  copies: string[]
  reads: string[]
  files: Record<string, string>
  listed: boolean
  opens: string[]
  closes: string[]
  fills: string[]
}

type Options = { refuseSwitch?: boolean; refuseWrite?: boolean; refuseRun?: boolean; categories?: string; noApp?: boolean }

function engine(on: On, options: Options = {}): Seen {
  const seen: Seen = { runs: [], writes: [], files: {}, mcp: [], prompts: [], copies: [], reads: [], listed: false, opens: [], closes: [], fills: [] }
  const files: Record<string, string> = seen.files
  Object.assign(files, {
    [`${PROFILE}/claude_desktop_config.json`]: DESKTOP_CONFIG,
    [INSTALLED_FILE]: INSTALLED,
    [SETTINGS_FILE]: SETTINGS,
    ...(options.categories ? { [CATEGORIES]: options.categories } : {}),
  })
  // A mod is not passed CLAUDE_CODE_EXECPATH: the profile is found by listing.
  const vars: Record<string, string> = { LOCALAPPDATA: LOCAL, USERPROFILE: HOME }
  on('fs.list', (_, e) => {
    const rows = TREE[norm(e.path ?? '')]
    if (rows === undefined) throw new Error('ENOENT')
    return { value: rows.map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }) as never)
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('env.get', (_, e) => ({ value: vars[e.name] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('fs.read', (_, e) => {
    const path = norm(e.path)
    seen.reads.push(path)
    if (path.endsWith('plugin.json')) return { value: '{"description":"una mod"}' }
    const text = files[path]
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: norm(e.path) in files || norm(e.path) === '/repo/.claude/skills/deploy' }))
  on('fs.write', (_, e) => {
    // The desktop app does not let a mod's code write the person's settings.
    if (options.refuseWrite) throw new Error('refused: a plugin may not write this file')
    const path = norm(e.path)
    seen.writes.push({ path, text: e.text })
    files[path] = e.text
    return { value: undefined } as never
  })
  on('settings.read', () => ({ value: JSON.parse(SETTINGS) }) as never)
  on('process.run', (_, e) => {
    const argv = [...(e as { argv: readonly string[] }).argv]
    seen.runs.push(argv)
    if (options.refuseRun && argv.includes('plugin')) throw new Error('spawn refused')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.list', () => {
    seen.listed = true
    return { value: COMMANDS } as never
  })
  let isOpen = false
  on('ui.panes', () =>
    ({
      value: isOpen ? [{ id: 'mod-hub', title: 'Mod, connettori e skill', isShown: true, isFocused: true, isPlaced: true }] : [],
    }) as never,
  )
  on('ui.open', (_, e) => {
    seen.opens.push(e.id)
    isOpen = true
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', (_, e) => {
    seen.closes.push(e.id)
    isOpen = false
    return { value: undefined } as never
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as never)
  on('prompt.fill', (_, e) => {
    seen.fills.push(e.text)
    return { isFilled: true } as never
  })
  on('tool.list', () => ({ value: TOOLS.map(name => ({ name, description: '', isMcp: name.startsWith('mcp__') })) }) as never)
  on('mcp.call', (_, e) => {
    seen.mcp.push({ tool: e.tool, args: e.args })
    if (options.noApp) throw new Error('no such server')
    if (e.tool === 'set_session_connector_enabled' && options.refuseSwitch) {
      throw new Error("in auto mode Claude Desktop doesn't run this tool when a plugin's own code calls it")
    }
    const text = e.tool === 'session_connectors_status' ? SERVERS : '{"ok":true}'
    return { value: { content: [{ type: 'text', text }], isError: false } } as never
  })
  on('prompt.submit', (_, e) => {
    seen.prompts.push(e.text)
    return { text: e.text } as never
  })
  on('ui.copy', (_, e) => {
    seen.copies.push(e.text)
    return { value: { isCopied: true } } as never
  })
  return seen
}

// The engine hands hooks absolute paths in the platform's own spelling.
const norm = (path: string) => path.split('\\').join('/').replace(/^[A-Za-z]:/, '')

const settle = async (done: () => boolean) => {
  for (let i = 0; i < 500 && !done(); i++) await Promise.resolve()
}

const START = { cwd: '/repo', surface: 'desktop', isInteractive: true } as const

// The hub fills its lists in the background after the session's start.
type Kit = Parameters<TestBody>[0]
async function start($: Kit, seen: Seen): Promise<void> {
  await $.session.start(START)
  await settle(() => seen.listed && seen.reads.includes(INSTALLED_FILE) && seen.mcp.length > 0)
  for (let i = 0; i < 300; i++) await Promise.resolve()
}

test('lists the mods with a toggle each, the hub without one', async ($, on) => {
  const seen = engine(on)
  await start($, seen)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'usage-band@claude-mods' }))?.text).toContain('Attiva')
    expect((await ui.find({ key: 'cyberpunk-look@claude-mods' }))?.text).toContain('Spenta')
    expect(await ui.find({ key: 'mod-hub@claude-mods' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /2 attive su 3/ }))?.text).toBe('2 attive su 3')
    await ui.unmount()
  }
})

test('lists the same connectors as the app menu, local servers and Chrome included', async ($, on) => {
  const seen = engine(on)
  await start($, seen)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // claude.ai connectors: a switch each
    expect((await ui.find({ key: 'conn:Claude Docs' }))?.text).toContain('Attivo')
    expect((await ui.find({ key: 'conn:Excalidraw' }))?.text).toContain('Spento')
    // local servers from the app's config, missing from the app's status
    expect((await ui.find({ key: 'crow-audiovault' }))?.text).toContain('spento')
    expect((await ui.find({ key: 'crow-home-assistant' }))?.text).toContain('spento')
    expect((await ui.find({ key: 'crow-jelly-stat' }))?.text).toContain('acceso')
    expect(await ui.find({ key: 'conn:audiovault' })).toBeUndefined()
    // Claude in Chrome, on through its tools
    expect((await ui.find({ key: 'crow-Claude in Chrome' }))?.text).toContain('acceso')
    // the session's other servers start closed
    expect(await ui.find({ key: 'crow-scheduled-tasks' })).toBeUndefined()
    expect((await ui.find({ key: 'group:conn-other' }))?.text).toContain('Altri server')
    expect((await ui.find({ type: 'Text', text: /attivi su 7/ }))?.text).toBe('4 attivi su 7')
    await ui.unmount()
  }
})

test("reads the app's config for the servers' names only", async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  expect(seen.reads).toContain(`${PROFILE}/claude_desktop_config.json`)
})

test('outside the app the connected servers show, read only', async ($, on) => {
  const seen = engine(on, { noApp: true })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'group:conn-other' })
  expect((await ui.find({ key: 'crow-claude-in-chrome' }))?.text).toContain('acceso')
  expect(await ui.find({ key: 'crow-audiovault' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Fuori dall'app desktop/ }))?.text).toContain('/mcp')
  await ui.unmount()
})

test("a switch flips the connector through the app's own tool", async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'conn:Excalidraw' })
  await settle(() => seen.mcp.some(c => c.tool === 'set_session_connector_enabled'))

  const call = seen.mcp.find(c => c.tool === 'set_session_connector_enabled')
  expect(call?.args).toEqual({ connector: 'Excalidraw', enabled: true })
  expect(seen.prompts).toEqual([])
  await ui.unmount()
})

test('where the app refuses a mod the switch, Claude is asked to flip it', async ($, on) => {
  const seen = engine(on, { refuseSwitch: true })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'conn:Claude Docs' })
  await settle(() => seen.prompts.length > 0)

  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toContain('disattiva il connettore "Claude Docs" per questa sessione.')
  expect((await ui.find({ key: 'conn:Claude Docs' }))?.text).toContain('…')
  await ui.unmount()
})

test('groups the skills by origin, plugin groups closed, mods commands left out', async ($, on) => {
  const seen = engine(on)
  await start($, seen)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'group:skill-project' }))?.text).toContain('Progetto')
    expect((await ui.find({ key: 'group:skill-personal' }))?.text).toContain('Personali')
    expect((await ui.find({ key: 'group:skill-plugin:anthropic-skills' }))?.text).toContain('Plugin anthropic-skills')
    expect(await ui.find({ key: 'skill:deploy' })).toBeDefined()
    expect(await ui.find({ key: 'skill:xal-forge' })).toBeDefined()
    // a plugin group starts closed
    expect(await ui.find({ key: 'skill:anthropic-skills:pdf' })).toBeUndefined()
    expect(await ui.find({ key: 'skill:mods' })).toBeUndefined()
    expect(await ui.find({ key: 'skill:tally' })).toBeUndefined()
    expect(await ui.find({ key: 'skill:help' })).toBeUndefined()
    expect(await ui.find({ key: 'group:skill-plugin:mod-hub' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'group:skill-plugin:anthropic-skills' })
  expect((await ui.find({ key: 'skill:anthropic-skills:pdf' }))?.text).toContain('Copia')
  await ui.unmount()
})

test("the person's category map comes first, with xal-* patterns", async ($, on) => {
  const seen = engine(on, { categories: JSON.stringify({ XAL: ['xal-*'], Design: ['brand', 'pdf'] }) })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'group:skill-cat:XAL' }))?.text).toContain('XAL')
  expect((await ui.find({ key: 'group:skill-cat:Design' }))?.text).toContain('Design')
  // matched by its name without the plugin prefix, so it leaves the plugin group
  expect(await ui.find({ key: 'skill:anthropic-skills:pdf' })).toBeDefined()
  expect(await ui.find({ key: 'group:skill-plugin:anthropic-skills' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Categorie da/ }))?.text).toContain('~/.claude/mod-hub/categorie.json')
  await ui.unmount()
})

test('copies a skill as /name for the message box', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'skill:xal-forge' })
  await settle(() => seen.copies.length > 0)
  expect(seen.copies).toEqual(['/xal-forge '])
  expect((await ui.find({ key: 'skill:xal-forge' }))?.text).toContain('Copiata')
  await ui.unmount()
})

// The drawn tree as plain data: every node with its key, props and children.
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown }
function nodes(tree: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(tree)) {
    for (const child of tree) nodes(child, out)
  } else if (tree && typeof tree === 'object') {
    const node = tree as Node
    out.push(node)
    nodes(node.children, out)
    nodes(node.props?.children, out)
  }
  return out
}
const keyed = (all: Node[], key: string) => all.find(n => n.props?.key === key)

test('three rounded cards: titles large, filter in the Skill header, notes in the footers', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = nodes(await ui.drawn())

  for (const section of ['connectors', 'skills', 'mods']) {
    expect(keyed(all, `card-${section}`)?.props?.borderStyle).toBe('round')
  }
  // The section's title is a heading, the groups' titles a smaller step.
  const headings = all.filter(n => n.type === 'Text' && n.props?.size === 'heading')
  expect(headings).toHaveLength(3)
  // The filter sits in the Skill card, before any of its groups.
  const skillCard = nodes(keyed(all, 'card-skills'))
  const order = skillCard.map(n => n.props?.key)
  expect(order.indexOf('skill-filter')).toBeGreaterThan(-1)
  expect(order.indexOf('skill-filter')).toBeLessThan(order.indexOf('group:skill-personal'))
  // The notes are the card's footer, in the small faint size.
  const footer = nodes(keyed(skillCard, 'foot-skills'))
  const notes = footer.filter(n => n.type === 'Text').map(n => n.props)
  expect(notes.length).toBe(2)
  expect(notes.every(p => p?.size === 'caption')).toBe(true)
  expect(nodes(keyed(all, 'foot-connectors')).some(n => n.type === 'Text')).toBe(true)
  await ui.unmount()
})

test('a press disables an active mod in settings.json, nothing else touched', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  await settle(() => seen.writes.length > 0)

  const write = seen.writes.find(w => w.path === SETTINGS_FILE)
  expect(write).toBeDefined()
  const written = JSON.parse(write?.text ?? '{}') as {
    enabledPlugins: Record<string, boolean>
    extraKnownMarketplaces: unknown
  }
  expect(written.enabledPlugins['usage-band@claude-mods']).toBe(false)
  expect(written.enabledPlugins['mod-hub@claude-mods']).toBe(true)
  // The rest of the person's settings survives the switch.
  expect(written.extraKnownMarketplaces).toEqual(JSON.parse(SETTINGS).extraKnownMarketplaces)
  // No `claude` is started: the binary is not on PATH under the desktop app.
  expect(seen.runs).toEqual([])
  await ui.unmount()
})

test('the row goes off at once, before the reload', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  await settle(() => seen.writes.length > 0)
  for (let i = 0; i < 300; i++) await Promise.resolve()

  expect((await ui.find({ key: 'usage-band@claude-mods' }))?.text).toContain('Spenta')
  expect((await ui.find({ type: 'Text', text: /Ricarica/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('where the app refuses the write, the CLI does it and nobody is asked', async ($, on) => {
  const seen = engine(on, { refuseWrite: true })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  await settle(() => seen.runs.length > 0)
  for (let i = 0; i < 300; i++) await Promise.resolve()

  // The binary the app carries, found by listing: `claude` is not on PATH.
  expect(seen.runs[0]).toEqual([EXE, 'plugin', 'disable', 'usage-band@claude-mods'])
  // A switch costs no tokens: Claude is never sent anything.
  expect(seen.prompts).toEqual([])
  await ui.unmount()
})

test('where both are refused the card says where to do it, still asking nobody', async ($, on) => {
  const seen = engine(on, { refuseWrite: true, refuseRun: true })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  await settle(() => seen.runs.length > 0)
  for (let i = 0; i < 300; i++) await Promise.resolve()

  expect(seen.prompts).toEqual([])
  expect((await ui.find({ type: 'Text', text: /Plugins/ }))?.text).toContain('usage-band')
  await ui.unmount()
})

// What a turn's end looks like to a hook.
const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the row catches up when a turn ends, the message still on the card', async ($, on) => {
  const seen = engine(on, { refuseWrite: true, refuseRun: true })
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'usage-band@claude-mods' })
  await settle(() => seen.runs.length > 0)

  // Switched from the app's own Plugins menu instead; the turn ends.
  seen.files[SETTINGS_FILE] = JSON.stringify({ enabledPlugins: { 'usage-band@claude-mods': false, 'mod-hub@claude-mods': true } })
  await $.turn.complete(TURN)
  for (let i = 0; i < 300; i++) await Promise.resolve()

  expect((await ui.find({ key: 'usage-band@claude-mods' }))?.text).toContain('Spenta')
  expect((await ui.find({ type: 'Text', text: /Plugins/ }))?.text).toContain('usage-band')
  await ui.unmount()
})

test('a mod already in the wanted state is not written again', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The file says off while the row, drawn before, still says on.
  seen.files[SETTINGS_FILE] = JSON.stringify({ enabledPlugins: { 'usage-band@claude-mods': false, 'mod-hub@claude-mods': true } })
  await ui.press({ key: 'usage-band@claude-mods' })
  for (let i = 0; i < 300; i++) await Promise.resolve()

  expect(seen.writes).toEqual([])
  expect(seen.runs).toEqual([])
  expect((await ui.find({ key: 'usage-band@claude-mods' }))?.text).toContain('Spenta')
  await ui.unmount()
})

const BAND = {
  plugin: 'mod-hub',
  component: 'AbovePromptList',
  requestId: 'band',
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
} as const

test('the band carries a Mod button that opens the pane, then closes it', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  expect(seen.opens).toEqual([])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'open-hub' }))?.text).toBe('⚙ Mod')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'open-hub' })
  await settle(() => seen.opens.length > 0)
  expect(seen.opens).toEqual(['mod-hub'])

  await ui.press({ key: 'open-hub' })
  await settle(() => seen.closes.length > 0)
  expect(seen.closes).toEqual(['mod-hub'])
  expect(seen.opens).toHaveLength(1)
  await ui.unmount()
})

test('minimized to a widget it shows a glance of the count', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Mod/ }))?.text).toBe('⚙ Mod')
  expect((await ui.find({ type: 'Text', text: /\// }))?.text).toBe('2/3')
  expect(await ui.find({ key: 'usage-band@claude-mods' })).toBeUndefined()
  await ui.unmount()
})

test('Ricarica writes /reload-plugins into an empty prompt box', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'reload' })
  await settle(() => seen.fills.length > 0)
  expect(seen.fills).toContain('/reload-plugins')
  await ui.unmount()
})

test('/mods opens the pane', async ($, on) => {
  const seen = engine(on)
  await start($, seen)
  await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(seen.opens).toEqual(['mod-hub'])
})

