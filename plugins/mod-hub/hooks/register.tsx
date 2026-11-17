import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderSurface } from 'claude-code'

import type { Connector, ConnectorGroup, Hub, Mod, Section, Skill } from '../types'

const PANE = 'mod-hub'
const TITLE = 'Mod, connettori e skill'
const SELF = 'mod-hub'
// The desktop app's own MCP server for the session's connectors.
const APP_CONNECTORS = 'ccd_connectors'
// The built-in browser extension's server, listed in the app's Connectors menu.
const CHROME = { server: 'claude-in-chrome', label: 'Claude in Chrome' }

const EMPTY: Hub = {
  mods: [],
  busy: null,
  error: null,
  needsReload: false,
  connectors: [],
  connectorSource: null,
  connectorError: null,
  pending: {},
  skills: [],
  filter: '',
  copied: null,
  categories: { path: '', isLoaded: false, error: null },
  collapsed: { mods: false, connectors: false, skills: false },
  open: {},
}

// Change the tag when Hub's fields change: a reload then declines the old value.
const hub = atom({ plugin: 'mod-hub', key: 'hub' } as const, EMPTY, { shape: 'hub-3' })

// The session's folder, for telling the project's skills from the person's own.
let cwd = ''

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// An environment variable, or undefined where it is unset or unreadable.
// $.env.get takes literal names, so each call site spells its own.
async function env(read: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return (await read()) ?? undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------- mods

type Listed = {
  id: string
  enabled: boolean
  readFromFolder?: string
  installPath?: string
}

async function claudeExe($: EngineInterface): Promise<string> {
  // The Claude Code binary this session runs on; the PATH one may be older.
  return (await env(() => $.env.get('CLAUDE_CODE_EXECPATH'))) ?? 'claude'
}

async function describe($: EngineInterface, row: Listed): Promise<string> {
  const folder = row.readFromFolder ?? row.installPath
  if (!folder) return ''
  try {
    const manifest = JSON.parse(await $.fs.read(`${folder}/.claude-plugin/plugin.json`)) as {
      description?: unknown
    }
    return typeof manifest.description === 'string' ? manifest.description : ''
  } catch {
    return ''
  }
}

async function refreshMods($: EngineInterface): Promise<void> {
  try {
    const exe = await claudeExe($)
    const { exitCode, stdout, stderr } = await $.process.run([exe, 'plugin', 'list', '--json'])
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
    const rows = JSON.parse(stdout) as Listed[]
    const mods: Mod[] = await Promise.all(
      rows.map(async row => {
        const [name = row.id, marketplace = ''] = row.id.split('@')
        return { id: row.id, name, marketplace, enabled: row.enabled, description: await describe($, row) }
      }),
    )
    mods.sort((a, b) => a.name.localeCompare(b.name))
    await update($, hub, h => ({ ...h, mods, error: null }))
  } catch (err) {
    await update($, hub, h => ({ ...h, error: `Non riesco a leggere le mod: ${message(err)}` }))
  }
}

async function toggleMod($: EngineInterface, mod: Mod): Promise<void> {
  await update($, hub, h => ({ ...h, busy: mod.id, error: null }))
  try {
    const exe = await claudeExe($)
    const verb = mod.enabled ? 'disable' : 'enable'
    const { exitCode, stderr } = await $.process.run([exe, 'plugin', verb, mod.id])
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
    await update($, hub, h => ({ ...h, needsReload: true }))
    $.ui.toast(`${mod.name} ${mod.enabled ? 'disattivata' : 'attivata'}: premi Ricarica per applicare`)
  } catch (err) {
    await update($, hub, h => ({ ...h, error: `${mod.name}: ${message(err)}` }))
  }
  await refreshMods($)
  await update($, hub, h => ({ ...h, busy: null }))
}

// ---------------------------------------------------------------- connectors
//
// The app's Connectors menu mixes three sources, and so does this list:
// - claude.ai connectors and the session's other servers: the app's own
//   `session_connectors_status` (a disabled local server is not in it);
// - the desktop app's local servers: `mcpServers` of its
//   claude_desktop_config.json, in the app's profile folder (names only);
// - Claude in Chrome and any local server switched on: their tools.

type AppServer = { name?: unknown; kind?: unknown; status?: unknown; tool_count?: unknown }

const isOn = (c: Connector) => c.status !== 'disabled'

// The name a server's tools carry: `mcp__<server>__<tool>`.
const toolKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_')

async function readAppStatus($: EngineInterface): Promise<AppServer[]> {
  const result = await $.mcp.call(APP_CONNECTORS, 'session_connectors_status', {})
  if (result.isError) throw new Error('il server dei connettori ha risposto con un errore')
  const block = result.content.find(b => b.type === 'text') as { text?: string } | undefined
  const parsed = JSON.parse(block?.text ?? '{}') as { servers?: AppServer[] }
  return (parsed.servers ?? []).filter(s => typeof s.name === 'string')
}

async function readToolServers($: EngineInterface): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const tool of await $.tool.list()) {
    const match = /^mcp__(.+?)__/.exec(tool.name)
    if (match?.[1]) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return counts
}

// The desktop app's config files, newest layout first: the app's profile
// folders under %LOCALAPPDATA%\Claude-Data (the one changed last first), then
// the classic per-user locations. (CLAUDE_CODE_EXECPATH, which names the
// profile, is not passed to a mod.)
async function desktopConfigPaths($: EngineInterface): Promise<string[]> {
  const paths: string[] = []
  const localAppData = await env(() => $.env.get('LOCALAPPDATA'))
  if (localAppData) {
    const root = `${localAppData}/Claude-Data`
    try {
      const found: { path: string; mtimeMs: number }[] = []
      for (const entry of await $.fs.list(root)) {
        if (entry.kind !== 'dir') continue
        const path = `${root}/${entry.name}/claude_desktop_config.json`
        if (await $.fs.exists(path)) found.push({ path, mtimeMs: (await $.fs.stat(path)).mtimeMs })
      }
      found.sort((a, b) => b.mtimeMs - a.mtimeMs)
      paths.push(...found.map(f => f.path))
    } catch {
      // no such folder: an older app or another platform
    }
  }
  const appData = await env(() => $.env.get('APPDATA'))
  if (appData) paths.push(`${appData}/Claude/claude_desktop_config.json`)
  const home = await env(() => $.env.get('HOME'))
  if (home) {
    paths.push(`${home}/Library/Application Support/Claude/claude_desktop_config.json`)
    paths.push(`${home}/.config/Claude/claude_desktop_config.json`)
  }
  return paths
}

// Only the servers' names are read: their commands and env stay untouched.
async function readLocalServers($: EngineInterface): Promise<string[]> {
  for (const path of await desktopConfigPaths($)) {
    try {
      const config = JSON.parse(await $.fs.read(path)) as { mcpServers?: Record<string, unknown> }
      return Object.keys(config.mcpServers ?? {})
    } catch {
      // not this one
    }
  }
  return []
}

async function refreshConnectors($: EngineInterface): Promise<void> {
  let app: AppServer[] | null = null
  try {
    app = await readAppStatus($)
  } catch {
    app = null
  }
  let tools = new Map<string, number>()
  try {
    tools = await readToolServers($)
  } catch {
    // the list goes on without them
  }
  const locals = app ? await readLocalServers($) : []

  const connectors: Connector[] = []
  const seen = new Set<string>()
  const add = (c: Connector) => {
    if (seen.has(c.name)) return
    seen.add(c.name)
    connectors.push(c)
  }
  const fromApp = (s: AppServer, group: ConnectorGroup, canSwitch: boolean): Connector => ({
    name: s.name as string,
    group,
    status: typeof s.status === 'string' ? s.status : 'connected',
    toolCount: typeof s.tool_count === 'number' ? s.tool_count : 0,
    canSwitch,
  })

  if (app) {
    for (const s of app) if (s.kind === 'connector') add(fromApp(s, 'claude.ai', true))
    for (const name of locals) {
      const row = app.find(s => s.name === name)
      const count = tools.get(toolKey(name)) ?? 0
      add(
        row
          ? fromApp(row, 'local', false)
          : { name, group: 'local', status: count ? 'connected' : 'disabled', toolCount: count, canSwitch: false },
      )
    }
    const chrome = tools.get(CHROME.server) ?? 0
    add({
      name: CHROME.label,
      group: 'builtin',
      status: chrome ? 'connected' : 'disabled',
      toolCount: chrome,
      canSwitch: false,
    })
    for (const s of app) add(fromApp(s, 'other', false))
  } else {
    // A terminal session: no app, so the servers connected now, read only.
    for (const [name, toolCount] of tools) {
      add({ name, group: 'other', status: 'connected', toolCount, canSwitch: false })
    }
  }

  const connectorSource: Hub['connectorSource'] = app ? 'desktop' : 'tools'
  await update($, hub, h => {
    // A switch asked for stays pending until the list shows it.
    const pending: Record<string, boolean> = {}
    for (const [name, wanted] of Object.entries(h.pending)) {
      const now = connectors.find(c => c.name === name)
      if (now && isOn(now) !== wanted) pending[name] = wanted
    }
    return { ...h, connectors, connectorSource, connectorError: null, pending }
  })
}

async function toggleConnector($: EngineInterface, connector: Connector): Promise<void> {
  const wanted = !isOn(connector)
  const verb = wanted ? 'attivato' : 'disattivato'
  await update($, hub, h => ({
    ...h,
    busy: `conn:${connector.name}`,
    connectorError: null,
    pending: { ...h.pending, [connector.name]: wanted },
  }))
  try {
    // The app's own switch. The desktop app may refuse it from a mod's code
    // (it does in auto mode): then Claude is asked to flip it, as the app says.
    const result = await $.mcp.call(APP_CONNECTORS, 'set_session_connector_enabled', {
      connector: connector.name,
      enabled: wanted,
    })
    if (result.isError) throw new Error('rifiutato')
    $.ui.toast(`${connector.name} ${verb}: vale dal prossimo messaggio`)
  } catch {
    // Sent framed as this plugin's message (no asUser): the transcript and the
    // model see it came from the panel's switch, not typed by the person.
    const ask =
      `Dal pannello Mod è stato premuto l'interruttore di un connettore: ` +
      `${wanted ? 'attiva' : 'disattiva'} il connettore "${connector.name}" per questa sessione.`
    $.prompt.submit({ text: ask }).catch(async (err: unknown) => {
      await update($, hub, h => {
        const { [connector.name]: _, ...pending } = h.pending
        return { ...h, pending, connectorError: `${connector.name}: ${message(err)}` }
      })
    })
    $.ui.toast(`Chiesto a Claude: ${connector.name} ${verb} appena la sessione è libera`)
  }
  await update($, hub, h => ({ ...h, busy: null }))
}

// ---------------------------------------------------------------- skills
//
// $.command.list() tells each command's source (`user`: the person's or the
// project's own files; `plugin`: a plugin's, with the plugin's name) and
// nothing about its topic. Groups come from that: the project's skills, the
// person's own, one group per plugin. The person can put skills into
// categories of their own with a small JSON file (see categoriesFile).

type Categories = { name: string; patterns: string[] }[]

async function categoriesFile($: EngineInterface): Promise<string> {
  const home = (await env(() => $.env.get('USERPROFILE'))) ?? (await env(() => $.env.get('HOME'))) ?? '~'
  return `${home.replace(/\\/g, '/')}/.claude/mod-hub/categorie.json`
}

async function readCategories($: EngineInterface, path: string): Promise<Categories | { error: string } | null> {
  let text: string
  try {
    if (!(await $.fs.exists(path))) return null
    text = await $.fs.read(path)
  } catch {
    return null
  }
  try {
    const raw = JSON.parse(text) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('serve un oggetto { "Categoria": ["skill", …] }')
    return Object.entries(raw as Record<string, unknown>).map(([name, list]) => ({
      name,
      patterns: Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [],
    }))
  } catch (err) {
    return { error: message(err) }
  }
}

// `xal-*` matches every name starting with `xal-`; anything else, the name itself.
function matches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name
}

async function isProjectSkill($: EngineInterface, name: string): Promise<boolean> {
  if (!cwd || name.includes(':')) return false
  try {
    return (await $.fs.exists(`${cwd}/.claude/skills/${name}`)) || (await $.fs.exists(`${cwd}/.claude/commands/${name}.md`))
  } catch {
    return false
  }
}

async function refreshSkills($: EngineInterface): Promise<void> {
  try {
    const path = await categoriesFile($)
    const read = await readCategories($, path)
    const categories = read && !('error' in read) ? read : []
    const commands = (await $.command.list()).filter(c => c.source === 'user' || c.source === 'plugin')
    const skills: Skill[] = await Promise.all(
      commands.map(async c => {
        const colon = c.name.indexOf(':')
        const plugin = c.plugin ?? (colon > 0 ? c.name.slice(0, colon) : null)
        const label = plugin && c.name.startsWith(`${plugin}:`) ? c.name.slice(plugin.length + 1) : c.name
        const category = categories.find(cat => cat.patterns.some(p => matches(p, c.name) || matches(p, label)))
        const group = category
          ? `cat:${category.name}`
          : c.source === 'plugin'
            ? `plugin:${plugin ?? 'altro'}`
            : (await isProjectSkill($, c.name))
              ? 'project'
              : 'personal'
        return { name: c.name, label, description: c.description, group }
      }),
    )
    skills.sort((a, b) => a.label.localeCompare(b.label))
    await update($, hub, h => ({
      ...h,
      skills,
      categories: { path, isLoaded: categories.length > 0, error: read && 'error' in read ? read.error : null },
    }))
  } catch (err) {
    await update($, hub, h => ({ ...h, error: `Non riesco a leggere le skill: ${message(err)}` }))
  }
}

async function systemClipboard($: EngineInterface, text: string): Promise<boolean> {
  const tools: string[][] = [['clip'], ['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard']]
  for (const argv of tools) {
    try {
      if ((await $.process.run(argv, { stdin: text })).exitCode === 0) return true
    } catch {
      // not on this machine: try the next one
    }
  }
  return false
}

// The desktop app draws its own message box, which a mod cannot write into
// ($.prompt.fill answers `no_composer`): the skill goes on the clipboard.
async function copySkill($: EngineInterface, skill: Skill, surface?: RenderSurface): Promise<void> {
  const text = `/${skill.name} `
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text, surface })).isCopied
  } catch {
    isCopied = false
  }
  if (!isCopied) isCopied = await systemClipboard($, text)
  if (isCopied) {
    await update($, hub, h => ({ ...h, copied: skill.name }))
    $.ui.toast(`Copiato ${text.trim()}: incollalo nel messaggio con Ctrl+V`)
  } else {
    await update($, hub, h => ({ ...h, error: `Non riesco a copiare /${skill.name} negli appunti` }))
  }
}

// ---------------------------------------------------------------- drawing helpers

function shorten(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = /^(.{20,}?[.!?])\s/.exec(flat)?.[1] ?? flat
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`
}

function statusLabel(c: Connector, pending: boolean | undefined): string {
  if (pending !== undefined) return pending ? '… si accende' : '… si spegne'
  switch (c.status) {
    case 'connected':
      return c.toolCount ? `● ${c.toolCount} ${c.toolCount === 1 ? 'strumento' : 'strumenti'}` : '● connesso'
    case 'disabled':
      return '○ spento'
    case 'needs_auth':
      return '⚠ da autorizzare (/mcp)'
    case 'failed':
      return '✕ errore'
    case 'pending':
      return '… in connessione'
    default:
      return c.status
  }
}

// Local servers and Claude in Chrome switch only from the app's own menu
// (no tool does it): the Connettori card says so in its footer.
const CONNECTOR_GROUPS: { group: ConnectorGroup; title: string; isOpen: boolean }[] = [
  { group: 'claude.ai', title: 'Connettori claude.ai', isOpen: true },
  { group: 'local', title: 'Server locali dell’app', isOpen: true },
  { group: 'builtin', title: 'Integrati', isOpen: true },
  { group: 'other', title: 'Altri server MCP della sessione', isOpen: false },
]

function skillGroupTitle(key: string): string {
  if (key === 'project') return 'Progetto'
  if (key === 'personal') return 'Personali'
  if (key.startsWith('cat:')) return key.slice(4)
  return `Plugin ${key.slice(7)}`
}

// Categories first (in the file's order), then project, personal, plugins.
function skillGroupOrder(key: string, categoryOrder: string[]): number {
  if (key.startsWith('cat:')) return categoryOrder.indexOf(key)
  if (key === 'project') return 1000
  if (key === 'personal') return 1001
  return 1002
}

async function refreshAll($: EngineInterface): Promise<void> {
  await Promise.all([refreshMods($), refreshConnectors($), refreshSkills($)])
}

// The band's "⚙ Mod" button: opens the pane, or closes it when it is open.
async function toggleHub($: EngineInterface): Promise<void> {
  try {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return
    }
    refreshAll($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
  } catch {
    // A pane refused or a hook's deny: nothing to undo.
  }
}

// The desktop app refuses /reload-plugins when a plugin runs it ("isn't
// available over a remote connection"), so the button writes the command into
// the prompt box and the person sends it with Enter. A draft already there is
// left alone. After the reload, session.start clears needsReload.
async function reloadPlugins($: EngineInterface): Promise<void> {
  try {
    const box = await $.prompt.read()
    if (box.text.trim() !== '') {
      $.ui.toast('La casella non è vuota: svuotala e premi di nuovo Ricarica')
      return
    }
    const filled = await $.prompt.fill({ text: '/reload-plugins' })
    $.ui.toast(filled.isFilled ? 'Premi Invio per ricaricare le mod' : 'Scrivi /reload-plugins per ricaricare')
  } catch (err) {
    await update($, hub, h => ({ ...h, error: `Ricarica non riuscita: ${message(err)}` }))
  }
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    cwd = e.cwd.replace(/\\/g, '/')
    await $.command.register({
      name: 'mods',
      description: 'Apre il pannello con mod, connettori e skill',
    })
    await update($, hub, h => ({ ...h, busy: null, needsReload: false, copied: null }))
    // The lists fill in the background: the session's start waits on nothing slow.
    refreshAll($).catch(() => undefined)
    return result
  })

  // Always at hand: a small "⚙ Mod" button at the right end of the band above
  // the prompt, drawn around every other plugin's rows. A press is the person
  // asking, so the pane is placed at any width.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const band = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const state = await read($, hub)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {band}
        </Box>
        <Box flexShrink={0}>
          <Button
            key="open-hub"
            label={state.needsReload ? '⚙ Mod ↻' : '⚙ Mod'}
            plain
            dimColor
            onPress={() => void toggleHub($)}
          />
        </Box>
      </Box>
    )
  })

  // A connector flipped by Claude, or from the app's menu, shows once a turn ends.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) void refreshConnectors($)
    return result
  })

  on('command.run', { command: 'mods' }, async $ => {
    await refreshAll($)
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return {
      text: opened.isPlaced ? 'Pannello aperto.' : `Pannello non mostrato: ${opened.reason}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const state = await read($, hub)
    const idle = state.busy === null
    const needle = state.filter.trim().toLowerCase()

    const toggleOpen = (key: string, isOpen: boolean) =>
      void update($, hub, h => ({ ...h, open: { ...h.open, [key]: !isOpen } }))

    // Indentation, in cells from the card's inner edge: a section's chevron at
    // 0, its groups' chevrons at GROUP, their rows under the group's title.
    const GROUP = 1
    const ROW = 3

    // A note at the foot of a card: small and faint, out of the content's way.
    const footnote = (key: string, text: string, color?: string) => (
      <Text key={key} size="caption" dimColor={!color} color={color} wrap="wrap">
        {text}
      </Text>
    )

    // One section as a card: a rounded border (the surface's own border color,
    // so it follows every theme), a header with a large title and its count on
    // the right, an optional bar under it, the body, and faint footnotes.
    const card = (
      section: Section,
      title: string,
      summary: string,
      body: () => RenderChildren,
      options: { bar?: RenderChildren; footer?: RenderChildren[] } = {},
    ) => {
      const isCollapsed = state.collapsed[section]
      const footer = (options.footer ?? []).filter(Boolean)
      return (
        <Box key={`card-${section}`} flexDirection="column" borderStyle="round" paddingX={1} gap="sm">
          <Box key={`head-${section}`} flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Button
              key={`sec:${section}`}
              label={title}
              plain
              onPress={() =>
                void update($, hub, h => ({
                  ...h,
                  collapsed: { ...h.collapsed, [section]: !h.collapsed[section] },
                }))
              }
            >
              <Text dimColor>{isCollapsed ? '▸ ' : '▾ '}</Text>
              <Text size="heading" weight="bold">
                {title}
              </Text>
            </Button>
            <Text dimColor size="footnote" tabular>
              {summary}
            </Text>
          </Box>
          {isCollapsed ? null : options.bar}
          {isCollapsed ? null : body()}
          {isCollapsed || footer.length === 0 ? null : (
            <Box key={`foot-${section}`} flexDirection="column" gap="xs">
              {footer}
            </Box>
          )}
        </Box>
      )
    }

    // A group inside a card: smaller and fainter than the card's title,
    // indented one step, its count on the right edge; its rows under its title.
    const group = (key: string, title: string, count: string, isOpen: boolean, rows: RenderChildren[]) => (
      <Box key={key} flexDirection="column" gap="sm">
        <Box key={`ghead-${key}`} flexDirection="row" alignItems="center" justifyContent="space-between" gap={1} paddingLeft={GROUP}>
          <Button key={`group:${key}`} label={title} plain dimColor onPress={() => toggleOpen(key, isOpen)}>
            <Text size="footnote">{isOpen ? '▾ ' : '▸ '}</Text>
            <Text size="footnote" weight="medium">
              {title}
            </Text>
          </Button>
          <Text dimColor size="footnote" tabular>
            {count}
          </Text>
        </Box>
        {isOpen ? (
          <Box key={`gbody-${key}`} flexDirection="column" gap="sm" paddingLeft={ROW}>
            {rows}
          </Box>
        ) : null}
      </Box>
    )

    // -- connectors
    const connectorRow = (c: Connector) => {
      const pending = state.pending[c.name]
      const canSwitch = c.canSwitch && state.connectorSource === 'desktop'
      return (
        <Box key={`crow-${c.name}`} flexDirection="row" gap={2} alignItems="center" justifyContent="space-between">
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text weight="semibold" color={isOn(c) ? 'text' : 'inactive'}>
              {c.name}
            </Text>
            <Text dimColor size="footnote">
              {statusLabel(c, pending)}
            </Text>
          </Box>
          <Box flexShrink={0}>
            {canSwitch ? (
              <Button
                key={`conn:${c.name}`}
                label={pending !== undefined || state.busy === `conn:${c.name}` ? '…' : isOn(c) ? '● Attivo' : '○ Spento'}
                variant={isOn(c) ? 'primary' : 'secondary'}
                dimColor={!isOn(c)}
                onPress={() => {
                  if (idle && pending === undefined) void toggleConnector($, c)
                }}
              />
            ) : (
              <Text key={`cstate:${c.name}`} dimColor size="footnote">
                {isOn(c) ? '● acceso' : '○ spento'}
              </Text>
            )}
          </Box>
        </Box>
      )
    }

    // -- skills: the mods' own commands are not skills
    const modNames = new Set(state.mods.map(m => m.name))
    modNames.add(SELF)
    const skills = state.skills
      .filter(s => !s.group.startsWith('plugin:') || !modNames.has(s.group.slice(7)))
      .filter(s => !needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
    const skillGroups = new Map<string, Skill[]>()
    for (const s of skills) skillGroups.set(s.group, [...(skillGroups.get(s.group) ?? []), s])
    const categoryOrder = [...new Set(state.skills.filter(s => s.group.startsWith('cat:')).map(s => s.group))]
    const orderedSkillGroups = [...skillGroups].sort(
      ([a], [b]) => skillGroupOrder(a, categoryOrder) - skillGroupOrder(b, categoryOrder) || a.localeCompare(b),
    )

    const skillRow = (s: Skill) => (
      <Box key={`srow-${s.name}`} flexDirection="row" gap={2} alignItems="center" justifyContent="space-between">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text weight="semibold">/{s.label}</Text>
          {s.description ? (
            <Text dimColor size="footnote" wrap="wrap">
              {shorten(s.description)}
            </Text>
          ) : null}
        </Box>
        <Box flexShrink={0}>
          <Button
            key={`skill:${s.name}`}
            label={state.copied === s.name ? '✓ Copiata' : 'Copia'}
            variant={state.copied === s.name ? 'primary' : 'secondary'}
            onPress={press => void copySkill($, s, press?.surface)}
          />
        </Box>
      </Box>
    )

    const activeMods = state.mods.filter(m => m.enabled).length
    const activeConnectors = state.connectors.filter(isOn).length

    // The minimized form: a glance, since clicks may not reach it.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1} paddingX={1}>
          <Text bold>⚙ Mod</Text>
          <Text dimColor>
            {activeMods}/{state.mods.length}
          </Text>
          {state.needsReload ? <Text color="warning">↻</Text> : null}
        </Box>
      )
    }

    // -- the cards
    const connectorsCard = card(
      'connectors',
      'Connettori',
      `${activeConnectors} attivi su ${state.connectors.length}`,
      () => (
        <Box key="connectors" flexDirection="column" gap="sm">
          {CONNECTOR_GROUPS.map(({ group: kind, title, isOpen: openByDefault }) => {
            const rows = state.connectors.filter(c => c.group === kind)
            if (rows.length === 0) return null
            const key = `conn-${kind}`
            const isOpen = state.open[key] ?? openByDefault
            return group(key, title, `${rows.filter(isOn).length}/${rows.length}`, isOpen, rows.map(connectorRow))
          })}
          {state.connectorError ? (
            <Text color="error" wrap="wrap">
              {state.connectorError}
            </Text>
          ) : null}
        </Box>
      ),
      {
        footer: [
          state.connectors.some(c => c.group === 'local' || c.group === 'builtin')
            ? footnote(
                'conn-note',
                'Server locali e Claude in Chrome si accendono e spengono dal menu + → Connettori dell’app.',
              )
            : null,
          state.connectorSource === 'tools'
            ? footnote('conn-tools', "Fuori dall'app desktop vedo solo i server connessi: si gestiscono con /mcp.")
            : null,
        ],
      },
    )

    const categoriesPath = state.categories.path.replace(/^.*?\/\.claude\//, '~/.claude/')
    const skillsCard = card(
      'skills',
      'Skill',
      `${skills.length} disponibili`,
      () => (
        <Box key="skills" flexDirection="column" gap="sm">
          {skills.length === 0 ? <Text dimColor>Nessuna skill trovata.</Text> : null}
          {orderedSkillGroups.map(([key, list]) => {
            const groupKey = `skill-${key}`
            const openByDefault = !key.startsWith('plugin:')
            // While filtering, every group with a match shows open.
            const isOpen = needle ? true : (state.open[groupKey] ?? openByDefault)
            return group(groupKey, skillGroupTitle(key), String(list.length), isOpen, list.map(skillRow))
          })}
        </Box>
      ),
      {
        // The filter belongs to the card's header, compact, with a search glyph.
        bar: (
          <Box key="skill-search" flexDirection="row" alignItems="center" gap={1}>
            <Text dimColor>⌕</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Input
                key="skill-filter"
                placeholder="Cerca una skill…"
                value={state.filter}
                onInput={value => void update($, hub, h => ({ ...h, filter: value }))}
                onSubmit={value => void update($, hub, h => ({ ...h, filter: value }))}
              />
            </Box>
          </Box>
        ),
        footer: [
          footnote('skill-copy', 'Copia mette /nome-skill negli appunti: incollalo nel messaggio con Ctrl+V.'),
          state.categories.error
            ? footnote('skill-cat', `Categorie non lette (${state.categories.error}): ${categoriesPath}`, 'warning')
            : footnote(
                'skill-cat',
                state.categories.isLoaded
                  ? `Categorie da ${categoriesPath}`
                  : `Categorie tue: crea ${categoriesPath}, ad esempio { "XAL": ["xal-*"] }.`,
              ),
        ],
      },
    )

    const modsCard = card(
      'mods',
      'Mod',
      state.mods.length === 0 ? 'nessuna installata' : `${activeMods} attive su ${state.mods.length}`,
      () => (
        <Box key="mods" flexDirection="column" gap="sm">
          {state.mods.map(mod => {
            const isSelf = mod.name === SELF
            const isBusy = state.busy === mod.id
            return (
              <Box key={`row-${mod.id}`} flexDirection="row" gap={2} alignItems="center" justifyContent="space-between">
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  <Text weight="semibold" color={mod.enabled ? 'text' : 'inactive'}>
                    {mod.name}
                  </Text>
                  {mod.description ? (
                    <Text dimColor size="footnote" wrap="wrap">
                      {mod.description}
                    </Text>
                  ) : null}
                </Box>
                <Box flexShrink={0}>
                  {isSelf ? (
                    <Text dimColor size="footnote">
                      sempre attiva
                    </Text>
                  ) : (
                    <Button
                      key={mod.id}
                      label={isBusy ? '…' : mod.enabled ? '● Attiva' : '○ Spenta'}
                      variant={mod.enabled ? 'primary' : 'secondary'}
                      dimColor={!mod.enabled}
                      onPress={() => {
                        if (idle) void toggleMod($, mod)
                      }}
                    />
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      ),
      {
        footer: [state.needsReload ? footnote('mods-reload', 'Premi ↻ Ricarica per applicare le modifiche.', 'warning') : null],
      },
    )

    return (
      <Box flexDirection="column" gap="md" paddingX={1}>
        <Box flexDirection="row" justifyContent="flex-end" gap={1}>
          <Button key="refresh" label="Aggiorna" dimColor onPress={() => void refreshAll($)} />
          <Button
            key="reload"
            label="↻ Ricarica"
            variant={state.needsReload ? 'primary' : 'secondary'}
            dimColor={!state.needsReload}
            onPress={() => void reloadPlugins($)}
          />
        </Box>
        {connectorsCard}
        {skillsCard}
        {modsCard}
        {state.error ? (
          <Text color="error" wrap="wrap">
            {state.error}
          </Text>
        ) : null}
      </Box>
    )
  })
}
