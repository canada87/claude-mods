# claude-mods

Mod personali per Claude Code (CLI e app desktop): piccoli plugin che cambiano
l'interfaccia e il comportamento di Claude. Questo repository è un
**marketplace**: si aggiunge una volta e da lì si installano, attivano e
disattivano le singole mod.

## Mod incluse

| Mod | Cosa fa |
| --- | --- |
| `mod-hub` | Pannello laterale (`/mods`) in tre sezioni: **Connettori** come nel menu dell'app (connettori claude.ai con interruttore, server locali dell'app, Claude in Chrome, altri server della sessione), **Skill** raggruppate per provenienza o per categorie tue, con filtro e pulsante *Copia* (`/nome-skill` negli appunti, da incollare nel messaggio), **Mod** installate con un interruttore ciascuna. |
| `usage-band` | Riga sopra il prompt con due barre in stile aurora (verde acqua → lilla): limite d'uso delle 5 ore e limite settimanale, percentuale e conto alla rovescia al reset. Ambra dal 70%, corallo dal 90%. |
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

- Con `mod-hub`: premi **⚙ Mod** in fondo alla band sopra il prompt (o scrivi `/mods`),
  usa gli interruttori nel pannello, poi **↻ Ricarica** (o `/reload-plugins`).
- App desktop: **+** → **Plugins**, interruttore accanto a ogni mod.
- Terminale: `claude plugin enable <mod>@claude-mods` / `claude plugin disable <mod>@claude-mods`.

### Limiti di `mod-hub` nell'app desktop

- **Connettori**: l'app desktop non lascia che il codice di una mod cambi un
  connettore (in auto mode lo rifiuta). L'interruttore prova la via diretta e,
  se rifiutata, manda a Claude un messaggio firmato dal pannello che chiede di
  accendere o spegnere quel connettore: il cambio arriva a fine turno e diventa
  anche il predefinito delle nuove sessioni.
- **Server locali e Claude in Chrome**: l'elenco viene da
  `claude_desktop_config.json` dell'app (se ne leggono solo i nomi) e dagli
  strumenti della sessione. Nessuno strumento dell'app li accende o spegne,
  neanche su richiesta a Claude: nel pannello si vede lo stato, il cambio si fa
  dal menu **+ → Connettori** dell'app. Lo stato si aggiorna a fine turno o con
  *Aggiorna*.
- **Skill**: l'app disegna da sé la casella del messaggio e una mod non può
  scriverci (`$.prompt.fill` risponde `no_composer`). *Copia* mette
  `/nome-skill` negli appunti: si incolla con Ctrl+V.

### Categorie delle skill

Di base le skill sono raggruppate per provenienza, l'unico dato che l'app
espone: **Progetto** (`.claude/skills` o `.claude/commands` della cartella
della sessione), **Personali** (le tue), e un gruppo per ogni plugin (chiuso
all'inizio). Per categorie tue crea `~/.claude/mod-hub/categorie.json`:

```json
{
  "XAL": ["xal-*"],
  "Design": ["brand", "banner-design", "design", "design-system", "slides", "ui-*"],
  "Documenti": ["pdf", "docx", "xlsx", "pptx"]
}
```

Ogni voce è il nome di una skill (con o senza il prefisso `plugin:`) o un
prefisso che finisce con `*`. Le categorie vengono prima, nell'ordine del file;
le skill non elencate restano nei gruppi per provenienza. Il file si rilegge con
*Aggiorna*.

## Sviluppo

Ogni mod vive in `plugins/<nome>/`. Con il marketplace aggiunto come cartella
locale (`claude plugin marketplace add <questa cartella>`) le modifiche si
leggono direttamente da qui: dopo un cambio basta `/reload-plugins`.

```bash
claude plugin validate plugins/usage-band
claude plugin test plugins/usage-band
```

Licenza MIT.
