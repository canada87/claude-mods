import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

// Neon over night rain: indigo-black surfaces, cyan accent, magenta chrome.
const { theme, problems } = makeColors({
  label: 'Cyberpunk notte',
  only: 'dark',
  roles: { accent: '#00e5ff', danger: '#ff3b6b', success: '#39ff9f', warning: '#ffd23f', pro: '#ff2fd1' },
  codeTheme: { dark: 'synthwave-84' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a0714',
        'surface-1': '#110c20',
        'surface-2': '#171029',
        'surface-3': '#1d1433',
        'text-primary': '#e9fbff',
        'text-secondary': '#b8c4e8',
        'text-muted': '#9098c4',
      },
    },
    git: { added: '#39ff9f', removed: '#ff3b6b', modified: '#ffd23f', merged: '#ff2fd1' },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: {
    scene: 'neon-rain',
    glass: { blur: 2, tint: '#0a0714', opacity: 0.55 },
  },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    const set = await $.theme.set(LOOK)
    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return (
      <Svg
        source={SCENE}
        alt="Una città notturna sotto la pioggia, con un sole al neon e una griglia che scorre"
        isInteractive
      />
    )
  })
}
