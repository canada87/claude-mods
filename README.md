# claude-mods

Mod personali per Claude Code (CLI e app desktop): piccoli plugin che cambiano
l'interfaccia e il comportamento di Claude. Questo repository è un
**marketplace**: si aggiunge una volta e da lì si installano, attivano e
disattivano le singole mod.

## Mod incluse

| Mod | Cosa fa |
| --- | --- |
| `usage-band` | Riga HUD cyberpunk sopra il prompt con due barre a segmenti: limite d'uso delle 5 ore e limite settimanale, percentuale e conto alla rovescia al reset. Giallo dal 70%, rosso dal 90%. |
| `cyberpunk-look` | Tema scuro per l'app desktop: superfici indaco, neon ciano e magenta, città notturna animata sotto la pioggia come sfondo. |

## Installazione

Da un terminale con Claude Code:

```
/plugin marketplace add canada87/claude-mods
/plugin install usage-band@claude-mods
```

Oppure da shell:

```bash
claude plugin marketplace add canada87/claude-mods
claude plugin install usage-band@claude-mods
```

Nell'app desktop: **+** accanto alla casella del messaggio → **Plugins** →
*Add marketplace* con `canada87/claude-mods` → *Add plugin*.

## Attivare e disattivare

- App desktop: **+** → **Plugins**, interruttore accanto a ogni mod.
- Terminale: `claude plugin enable <mod>@claude-mods` / `claude plugin disable <mod>@claude-mods`.

## Sviluppo

Ogni mod vive in `plugins/<nome>/`. Con il marketplace aggiunto come cartella
locale (`claude plugin marketplace add <questa cartella>`) le modifiche si
leggono direttamente da qui: dopo un cambio basta `/reload-plugins`.

```bash
claude plugin validate plugins/usage-band
claude plugin test plugins/usage-band
```

Licenza MIT.
