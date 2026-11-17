export type Mod = {
  id: string
  name: string
  marketplace: string
  description: string
  enabled: boolean
}

/**
 * Where a connector comes from, as the app's Connectors menu mixes them:
 * `claude.ai` connectors (switchable), `local` servers of the desktop app's
 * config, `builtin` ones (Claude in Chrome), and the session's `other` MCP
 * servers (plugins, project, scheduled tasks).
 */
export type ConnectorGroup = 'claude.ai' | 'local' | 'builtin' | 'other'

export type Connector = {
  name: string
  group: ConnectorGroup
  /** connected | needs_auth | failed | pending | disabled */
  status: string
  toolCount: number
  /** True where the app's own tool takes a switch for it. */
  canSwitch: boolean
}

/** A skill (or a user/plugin slash command) the person can invoke. */
export type Skill = {
  /** What the person types after the slash, prefix included. */
  name: string
  /** The name shown inside its group: without a `plugin:` prefix. */
  label: string
  description: string
  /** Group key: `cat:<name>` (the person's map), `project`, `personal`, `plugin:<name>`. */
  group: string
}

export type Section = 'mods' | 'connectors' | 'skills'

export type Hub = {
  mods: Mod[]
  busy: string | null
  error: string | null
  needsReload: boolean

  connectors: Connector[]
  /** Where the list came from: the desktop app, or the tools alone (terminal). */
  connectorSource: 'desktop' | 'tools' | null
  connectorError: string | null
  /** Connector name → the state asked for and not yet seen in the list. */
  pending: Record<string, boolean>

  skills: Skill[]
  filter: string
  /** The skill name last copied, shown as a tick on its row. */
  copied: string | null
  /** The person's category map, when the file is there. */
  categories: { path: string; isLoaded: boolean; error: string | null }

  collapsed: Record<Section, boolean>
  /** Group key → open, where the person opened or closed it. */
  open: Record<string, boolean>
}

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': { hub: Shaped<Hub> }
  }
}
