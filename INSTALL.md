# Installare le mod di `claude-mods`

Questo repository è un **marketplace**: si aggiunge una volta, e da lì si
installano le singole mod. Due passi sempre, in quest'ordine:

1. aggiungere il marketplace (`claude-mods`);
2. installare le mod che servono (`mod-hub`, `usage-band`, `cyberpunk-look`).

Dopo l'installazione le mod **non sono ancora attive nella sessione aperta**:
serve `/reload-plugins` (o riavviare Claude).

---

## Scegliere la strada

| | Da GitHub | Dalla cartella locale |
| --- | --- | --- |
| Comando | `canada87/claude-mods` | il percorso di questa cartella |
| Il codice che gira | una copia sotto `~/.claude/plugins/cache/` | **i file di questa cartella**, letti ad ogni avvio |
| Dopo una modifica al codice | `plugin marketplace update` + `plugin update` | basta `/reload-plugins` |
| Per chi | usare le mod | svilupparle |

Su questa macchina le mod sono installate **dalla cartella locale**: è la
scelta giusta, visto che il repository è qui e lo si modifica. Chi vuole solo
usarle (un'altra macchina, un collega) usa la strada GitHub.

---

## App desktop (la via normale qui)

Nell'app desktop il binario `claude` **non è nel PATH**: l'app ne porta uno
suo dentro `%LOCALAPPDATA%\Claude-Data\...`, non raggiungibile da un terminale
qualsiasi. Quindi si fa tutto dall'interfaccia:

1. **+** accanto alla casella del messaggio → **Plugins**;
2. **Add marketplace** → incolla, a scelta:
   - `canada87/claude-mods` (da GitHub), oppure
   - `C:\Users\<utente>\...\PersonalProjects\claude-mods` (la cartella locale,
     quella che contiene `.claude-plugin/marketplace.json`);
3. dalla lista del marketplace, **Add plugin** su ognuna delle mod;
4. scrivi `/reload-plugins` nel messaggio e premi Invio.

Da dentro una sessione funziona anche `/plugin` (apre la stessa gestione).

---

## Terminale (solo se hai la CLI installata)

La CLI è un pacchetto a parte dall'app desktop:

```powershell
npm install -g @anthropic-ai/claude-code
```

Poi, da GitHub:

```powershell
claude plugin marketplace add canada87/claude-mods
```

```powershell
claude plugin install mod-hub@claude-mods; claude plugin install usage-band@claude-mods; claude plugin install cyberpunk-look@claude-mods
```

Oppure dalla cartella locale (il percorso della cartella che contiene
`.claude-plugin/marketplace.json`):

```powershell
claude plugin marketplace add "C:\Users\<utente>\...\PersonalProjects\claude-mods"
```

In entrambi i casi, alla fine, `/reload-plugins` nella sessione aperta.

---

## Cosa scrive Claude Code

Tre file, tutti sotto `~/.claude` (o sotto `CLAUDE_CONFIG_DIR`, se è
impostata). Guardare qui è il modo più veloce per capire se l'installazione è
andata a buon fine:

| File | Cosa contiene |
| --- | --- |
| `plugins/known_marketplaces.json` | i marketplace aggiunti e la loro sorgente (`github` o `directory`) |
| `plugins/installed_plugins.json` | le mod installate, con versione e `installPath` |
| `settings.json` → `enabledPlugins` | quali mod sono **accese** (`"mod-hub@claude-mods": true`) |

Installare e accendere sono due cose diverse: una mod installata ma assente
da `enabledPlugins` (o messa a `false`) non viene caricata.

La copia del codice sta in `~/.claude/plugins/cache/claude-mods/<mod>/<versione>/`.
Con un marketplace di tipo `directory` quella copia serve solo da riferimento:
il codice eseguito è quello della cartella del repository (`readFromFolder`).

---

## Verificare

Nell'app: **⚙ Mod** in fondo alla riga sopra il prompt, oppure `/mods`. Il
pannello elenca le mod installate con un interruttore ciascuna; `mod-hub` si
vede come «sempre attiva».

Con la CLI installata:

```powershell
claude plugin list --json
```

---

## Aggiornare, spegnere, rimuovere

- **Dopo una modifica al codice** (installazione da cartella locale):
  `/reload-plugins`, nient'altro.
- **Aggiornare da GitHub**: `claude plugin marketplace update claude-mods`
  e poi `claude plugin update <mod>@claude-mods`.
- **Accendere / spegnere**: l'interruttore nel pannello `/mods` (scrive
  `enabledPlugins` in `~/.claude/settings.json`), oppure **+ → Plugins**,
  oppure `claude plugin enable|disable <mod>@claude-mods`. In tutti i casi
  serve poi `/reload-plugins`.
- **Rimuovere**: `claude plugin uninstall <mod>@claude-mods`, e
  `claude plugin marketplace remove claude-mods` per togliere il marketplace.

---

## Se qualcosa non va

**Il pannello `/mods` non elenca le mod.**
Era un difetto di `mod-hub` fino alla 0.1.0: la lista veniva da
`claude plugin list`, ma una mod non riceve `CLAUDE_CODE_EXECPATH` e il
binario dell'app desktop non è nel PATH, quindi quel comando non partiva mai e
la scheda **Mod** restava vuota con un errore in rosso. Dalla 0.2.0 la lista
si legge da `installed_plugins.json` e da `enabledPlugins`, senza avviare
niente. Se vedi ancora la scheda vuota, fai `/reload-plugins`.

**Premo l’interruttore nel pannello e la mod resta accesa.**
Dalla 0.2.1 il pannello prova a scrivere `enabledPlugins` in
`~/.claude/settings.json` e, se l’app desktop rifiuta la scrittura a una mod,
chiede a Claude di farla e lascia il motivo in rosso in fondo alla scheda.
Prima della 0.2.1 il rifiuto veniva cancellato subito dopo: il tocco sembrava
non fare niente. La riga si aggiorna a fine turno, appena Claude ha scritto;
in ogni caso la modifica vale dopo `/reload-plugins`.

**La mod non compare per niente** (nessun `⚙ Mod`, nessuna barra).
Controlla che sia in `enabledPlugins` con valore `true` in
`~/.claude/settings.json`, e che il percorso in `known_marketplaces.json`
esista ancora.

**La cartella è su OneDrive** (come qui).
Tienila su *Mantieni sempre su questo dispositivo*: se OneDrive la
«smaterializza», i file diventano segnaposto e il caricamento di una mod può
fallire in modo intermittente. In alternativa, installa da GitHub.

**Hai modificato il codice e non cambia niente.**
Con l'installazione da GitHub il codice che gira è la copia in `cache/`, non
la cartella del repository: o reinstalli da cartella locale, o fai
`marketplace update` + `plugin update`.

**Controllare una mod prima di installarla:**

```powershell
claude plugin validate plugins/mod-hub
```

```powershell
claude plugin test plugins/mod-hub
```
