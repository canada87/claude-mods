export type Window = { percentUsed: number; resetsAt?: string }
export type Limits = { five: Window | null; week: Window | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { limits: Limits; now: number }
  }
}
