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

Due passi: si aggiunge il marketplace, poi si installano le mod. Nell’app
desktop: **+** accanto alla casella del messaggio → **Plugins** → *Add
marketplace* con `canada87/claude-mods` (o con il percorso di questa
cartella) → *Add plugin* su ogni mod → `/reload-plugins`.

Con la CLI installata (`npm install -g @anthropic-ai/claude-code`; il binario
dell’app desktop non sta nel PATH):

```bash
claude plugin marketplace add canada87/claude-mods
claude plugin install mod-hub@claude-mods
```

**[INSTALL.md](INSTALL.md)** è la guida completa: le due strade
(GitHub o cartella locale) e quando usarle, i file che Claude Code scrive,
come verificare, aggiornare e rimuovere, e cosa fare quando qualcosa non va.

## Attivare e disattivare

- Con `mod-hub`: premi **⚙ Mod** in fondo alla band sopra il prompt (o scrivi `/mods`),
  usa gli interruttori nel pannello, poi **↻ Ricarica** (o `/reload-plugins`).
- App desktop: **+** → **Plugins**, interruttore accanto a ogni mod.
- Terminale: `claude plugin enable <mod>@claude-mods` / `claude plugin disable <mod>@claude-mods`.

L’interruttore del pannello scrive `enabledPlugins` in `~/.claude/settings.json`,
la stessa chiave e lo stesso file di `claude plugin enable`. Non costa token:
non passa mai da Claude.

### Limiti di `mod-hub` nell'app desktop

- **Mod**: l’elenco si legge da `installed_plugins.json` e da `enabledPlugins`,
  non dalla CLI: una mod non riceve `CLAUDE_CODE_EXECPATH` e il binario
  dell’app non è nel PATH, quindi `claude plugin list` non partirebbe mai.
  L’interruttore prova prima a scrivere `~/.claude/settings.json`; se l’app
  lo rifiuta, lancia `claude plugin enable|disable` sul binario che l’app si
  porta dentro `%LOCALAPPDATA%/Claude-Data/<profilo>/claude-code/...`, trovato
  elencando le cartelle. Se nessuna delle due strade passa, la scheda dice di
  usare **+ → Plugins**. In nessun caso viene chiesto niente a Claude: premere
  un interruttore non consuma token. Poi serve ↻ Ricarica.
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
leggono direttamente da qui: dopo un cambio basta `/reload-plugins`. I
dettagli, e la differenza con l’installazione da GitHub, sono in
[INSTALL.md](INSTALL.md).

```bash
claude plugin validate plugins/usage-band
claude plugin test plugins/usage-band
```

Licenza MIT.
