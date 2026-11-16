# itslearning-mcp – Kontext für Agenten

Lesender MCP-Server für **itslearning** (Lernplattform von Schulen), damit KI-Agenten Aufgaben, Neuigkeiten, Nachrichten und Dateien eines Schülerkontos lesen können – mit **Schwärzung personenbezogener Daten**. Allgemein nutzbar für jede itslearning-Instanz mit nativem Login (`ITSL_BASE_URL`).

- **Aktueller Stand und nächste Aufgaben:** [`docs/next-steps.md`](docs/next-steps.md) – zuerst lesen.
- Spezifikation: [`docs/mcp-server-spec.md`](docs/mcp-server-spec.md)
- Verifizierte API-Erkenntnisse (Endpunkte, Auth, Download-Flows): [`docs/itslearning-api.md`](docs/itslearning-api.md)
- Bedienung/Betrieb: [`README.md`](README.md)

Sprache im Projekt: **Deutsch** (Doku, Kommentare, Tool-Beschreibungen, Fehlermeldungen). Commit-Messages auf Englisch.

## Datenschutz – harte Regeln

Das Projekt wurde für das Konto eines Kindes an einer konkreten Schule gebaut. Das Repo (privat auf GitHub) soll trotzdem **keinen Hinweis auf die Schule** enthalten.

- **Nie ins Repo:** Name, Ort, Instanz-URL oder Customer-ID der Schule; echte Namen, Kurstitel, Element-/Personen-IDs aus dem Konto; Inhalte aus `probe-output/`, `.data/`, `downloads/`, `secrets/`, `.env` (alle gitignored).
- Vor jedem Commit den Staged-Diff durchsuchen, z. B. `git diff --cached | grep -nE '<instanz>|<schulname>|<ort>|<customerId>'` (konkrete Begriffe stehen in der lokalen `.env` bzw. sind dem Nutzer bekannt – nicht hier eintragen).
- **Testdaten sind erfunden** (`test/fixtures.ts`, `test/fakeWeb.ts`: „Jonas Beispielmann“, „Sabine Lindqvist“ …). Keine echten Daten in Tests.
- **Bun lädt `.env` automatisch** – darin stehen echte Zugangsdaten. Wer Server/Skripte lokal zum Testen startet, ohne das echte Konto zu nutzen, muss `ITSL_BASE_URL`/`ITSL_USERNAME`/`ITSL_PASSWORD` explizit mit Dummy-Werten überschreiben (z. B. `ITSL_BASE_URL=https://example.itslearning.com`) und ein eigenes `DATA_DIR` im Scratchpad setzen. Gegen das echte Konto testet der Nutzer selbst (`bun run call …`, `bun run smoke`) oder über den eingebundenen MCP-Server.
- Ausgaben, die geteilt werden sollen (Reports, Smoke-Test), enthalten nur **Struktur/Zählungen**, nie Inhalte – siehe `scripts/smokeCore.ts` (Maskierung `x`/`9`).
- Wenn echte (geschwärzte) Daten über die MCP-Tools in den Chat kommen: im Bericht nur Muster beschreiben, keine Namen/Kurstitel in Dateien übernehmen.

## Architektur (kurz)

Bun + TypeScript (strict) + `@modelcontextprotocol/sdk` + `zod`. Kein Build-Schritt; `bun src/server.ts`.

| Pfad | Inhalt |
|---|---|
| `src/server.ts` | Einstieg; `MCP_TRANSPORT=stdio` (Default) oder `http` |
| `src/http.ts` | Streamable HTTP auf `Bun.serve`, zustandslos (pro Request neuer `McpServer` über gemeinsamem Kontext), Bearer-API-Key, `/healthz`, Origin-Check |
| `src/app.ts` | Verdrahtung (`createApp`), Server-Instructions, Tool-Registrierung |
| `src/context.ts` | `AppContext`, `ensureReady()` (Login, eigenes Konto als „Ich“, Namens-Wörterbuch mit Thread-Teilnehmer:innen vorwärmen) |
| `src/auth/` | OAuth2 Password-Grant mit Client-ID der Mobile-App, **rotierender Refresh-Token** → `DATA_DIR/state.json`; falsches Passwort = fatal (kein Retry, Konto-Sperre vermeiden) |
| `src/api/` | REST-Client (Limiter, TTL-Cache, Retry), typisierte Endpunkte |
| `src/redaction/` | Personen-Registry (Rollen, HMAC-Pseudonyme), `teachers.json` (Anrede, Hot-Reload), Namens-Wörterbuch, Geheimnis-/URL-Filter, HTML→Text |
| `src/files/`, `src/websession/` | fileRefs (`e_`/`a_`/`m_`/`i_`, zustandslos), Download-Flows (SSO → Web-Session → iframes → `DownloadRedirect`), Textextraktion (unpdf, mammoth), Disk-Cache |
| `src/tools/` | Ein Modul pro Tool-Gruppe; DTOs sind **Allowlists** (nie Roh-API-Antworten durchreichen) |
| `scripts/` | `call.ts` (Tool gegen echte Instanz aufrufen), `smoke.ts`/`smokeCore.ts` (Leak-Prüfung), `probe*.ts` (API-Erkundung) |

### Wichtige Invarianten
- **Erst Personen registrieren, dann Texte schwärzen** (`registerThread`, `registerPublishedBy`, `warmCourse`/`warmForFileRef` in `src/tools/people.ts`).
- Jeder Freitext läuft durch `ctx.redactor.text()` bzw. `.title()`; Dateinamen durch `redactFileName()`.
- Geheime URLs (Tokens, SSO-, Session-, filerepository-/filecache-Links) verlassen nie `FileService`/`websession` und werden nicht geloggt (Logger schwärzt registrierte Secrets und URLs).
- Externe Links nur, wenn `isShareableUrl()` (prüft Host, Parameter-Namen **und -Werte**).
- Logs nach stderr (stdout gehört bei stdio dem MCP-Protokoll), keine Inhalte loggen.
- Claude Code zeigt bei Tools mit `structuredContent` offenbar nur diese an → alles, was der Agent sehen muss, gehört in `structuredContent` (siehe `docs/next-steps.md` 1.1).

## Befehle

```bash
bun install
bun run typecheck
bun test                         # ~100 Tests, keine echten Daten, kein Netzwerk
bun run call [tool] [key=value…] # Tool gegen echte Instanz (nutzt .env bzw. fragt ab)
bun run smoke --details          # Leak-Prüfung gegen echte Instanz, Ausgabe teilbar
docker compose up -d --build     # HTTP-Server auf 127.0.0.1:3000 (Secrets in ./secrets/)
```

Der Server ist in Claude Code für dieses Projekt als MCP-Server `itslearning` (HTTP, Docker) eingetragen. Nach Code-Änderungen muss der Nutzer den Container neu bauen, damit der eingebundene Server sie hat.

## Arbeitsweise mit dem Nutzer

- Commits/Push/Git-Schreibvorgänge nur nach ausdrücklicher Zustimmung (globale Regeln in `~/.claude/CLAUDE.md`). Hauptbranch heißt **`master`**; Remote `origin` = privates GitHub-Repo.
- Echte Tests (Login, Smoke-Test) führt der Nutzer in seinem eigenen Terminal aus und schickt die (teilbare) Ausgabe.
- Bei jedem Fund einer Schwärzungslücke: Ursache mit Struktur-Diagnose nachstellen, Regressionstest mit erfundenen Daten schreiben, dann fixen.
