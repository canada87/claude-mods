export type Mod = {
  id: string
  name: string
  marketplace: string
  description: string
  enabled: boolean
}

export type Hub = {
  mods: Mod[]
  busy: string | null
  error: string | null
  needsReload: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'mod-hub': { hub: Shaped<Hub> }
  }
}
