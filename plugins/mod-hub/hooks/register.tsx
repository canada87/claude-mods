import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hub, Mod } from '../types'

const PANE = 'mod-hub'
const SELF = 'mod-hub'
const EMPTY: Hub = { mods: [], busy: null, error: null, needsReload: false }

// Change the tag when Hub's fields change: a reload then declines the old value.
const hub = atom({ plugin: 'mod-hub', key: 'hub' } as const, EMPTY, { shape: 'hub-1' })

type Listed = {
  id: string
  enabled: boolean
  readFromFolder?: string
  installPath?: string
}

async function claudeExe($: EngineInterface): Promise<string> {
  // The Claude Code binary this session runs on; the PATH one may be older.
  try {
    return (await $.env.get('CLAUDE_CODE_EXECPATH')) ?? 'claude'
  } catch {
    return 'claude'
  }
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

async function refresh($: EngineInterface): Promise<void> {
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
    const message = err instanceof Error ? err.message : String(err)
    await update($, hub, h => ({ ...h, error: `Non riesco a leggere le mod: ${message}` }))
  }
}

async function toggle($: EngineInterface, mod: Mod): Promise<void> {
  await update($, hub, h => ({ ...h, busy: mod.id, error: null }))
  try {
    const exe = await claudeExe($)
    const verb = mod.enabled ? 'disable' : 'enable'
    const { exitCode, stderr } = await $.process.run([exe, 'plugin', verb, mod.id])
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`)
    await update($, hub, h => ({ ...h, needsReload: true }))
    $.ui.toast(`${mod.name} ${mod.enabled ? 'disattivata' : 'attivata'}: premi Ricarica per applicare`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, hub, h => ({ ...h, error: `${mod.name}: ${message}` }))
  }
  await refresh($)
  await update($, hub, h => ({ ...h, busy: null }))
}

// The band's "⚙ Mod" button: opens the pane, or closes it when it is open.
async function toggleHub($: EngineInterface): Promise<void> {
  try {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return
    }
    void refresh($)
    await $.ui.open({ id: PANE, title: 'Mod', focus: true })
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
    const message = err instanceof Error ? err.message : String(err)
    await update($, hub, h => ({ ...h, error: `Ricarica non riuscita: ${message}` }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'mods',
      description: 'Apre il pannello delle mod: attiva e disattiva quelle installate',
    })
    await update($, hub, h => ({ ...h, busy: null, needsReload: false }))
    await refresh($)
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

  on('command.run', { command: 'mods' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Mod', focus: true })
    return {
      text: opened.isPlaced ? 'Pannello delle mod aperto.' : `Pannello non mostrato: ${opened.reason}`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, hub)
    const active = state.mods.filter(m => m.enabled).length

    // The minimized form: a glance, since clicks may not reach it.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" gap={1} paddingX={1}>
          <Text bold>⚙ Mod</Text>
          <Text dimColor>
            {active}/{state.mods.length}
          </Text>
          {state.needsReload ? <Text color="warning">↻</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor>
            {state.mods.length === 0
              ? 'Nessuna mod installata'
              : `${active} attive su ${state.mods.length}`}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" label="Aggiorna" dimColor onPress={() => void refresh($)} />
            <Button
              key="reload"
              label="↻ Ricarica"
              variant={state.needsReload ? 'primary' : 'secondary'}
              dimColor={!state.needsReload}
              onPress={() => void reloadPlugins($)}
            />
          </Box>
        </Box>

        {state.mods.map(mod => {
          const isSelf = mod.name === SELF
          const isBusy = state.busy === mod.id
          return (
            <Box key={`row-${mod.id}`} flexDirection="row" gap={2} justifyContent="space-between">
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text bold color={mod.enabled ? 'text' : 'inactive'}>
                  {mod.name}
                </Text>
                {mod.description ? (
                  <Text dimColor wrap="wrap">
                    {mod.description}
                  </Text>
                ) : null}
              </Box>
              <Box flexShrink={0}>
                {isSelf ? (
                  <Text dimColor>sempre attiva</Text>
                ) : (
                  <Button
                    key={mod.id}
                    label={isBusy ? '…' : mod.enabled ? '● Attiva' : '○ Spenta'}
                    variant={mod.enabled ? 'primary' : 'secondary'}
                    dimColor={!mod.enabled}
                    onPress={() => {
                      if (state.busy === null) void toggle($, mod)
                    }}
                  />
                )}
              </Box>
            </Box>
          )
        })}

        {state.error ? (
          <Text color="error" wrap="wrap">
            {state.error}
          </Text>
        ) : null}
        {state.needsReload ? (
          <Text color="warning" wrap="wrap">
            Premi ↻ Ricarica per applicare le modifiche.
          </Text>
        ) : null}
      </Box>
    )
  })
}
