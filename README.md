# itslearning-mcp

MCP-Server, der KI-Agenten **lesenden** Zugriff auf ein itslearning-Konto gibt – mit Schwärzung personenbezogener Daten.

- Spezifikation: [`docs/mcp-server-spec.md`](docs/mcp-server-spec.md)
- API-Erkenntnisse: [`docs/itslearning-api.md`](docs/itslearning-api.md)

## Status

| Meilenstein | Inhalt | Stand |
|---|---|---|
| M1 | Grundgerüst, Config, Login/Refresh, `list_courses`, `list_tasks`, `get_task`, stdio | ✅ |
| M2 | Personen-Registry, Lehrkräfte-Verzeichnis, `overview`, `list_news`, `list_bulletins`, `list_message_threads`, `get_message_thread` | ✅ |
| M3 | `list_course_files`, `download_file` (Textextraktion PDF/DOCX, Cache), fileRefs in Aufgaben/Nachrichten/Ankündigungen | ✅ |
| M4 | HTTP-Transport, Docker, Smoke-Test | ⏳ |

## Voraussetzungen

- [Bun](https://bun.sh) ≥ 1.4
- itslearning-Instanz mit **nativem Login** (Benutzername/Passwort). Instanzen, die nur Login über einen fremden Anbieter (Microsoft, Google, IServ …) anbieten, werden in v1 nicht unterstützt.

## Schnellstart (lokal, stdio)

```bash
bun install
bun test

# Tools auflisten (ohne Login)
bun run call

# Gegen das echte Konto testen (Zugangsdaten aus .env oder interaktive Abfrage, Passwort verdeckt)
bun run call itslearning_overview
bun run call itslearning_list_tasks limit=5
bun run call itslearning_get_task elementId=123
bun run call itslearning_list_news limit=10
bun run call itslearning_list_bulletins courseId=123
bun run call itslearning_list_message_threads unreadOnly=true
bun run call itslearning_get_message_thread threadId=123
bun run call itslearning_list_course_files courseId=123 recursive=true
bun run call itslearning_download_file fileRef=e_123
```

Tipp: `.env.example` nach `.env` kopieren und ausfüllen – Bun lädt sie automatisch, `.env` ist von Git ausgeschlossen.

In `.data/` liegen danach:
- `state.json` – Login-Status (rotierender Refresh-Token; das Passwort wird nicht gespeichert)
- `secret` – Schlüssel für stabile Pseudonyme
- `teachers.json` – Lehrkräfte-Verzeichnis (siehe unten)
- `files/` – Datei-Cache (24 h, max. 500 MB)

### Dateien

Tools liefern `fileRef`-Werte (z. B. `e_123` Kurs-Element, `a_1_2` Aufgaben-Anhang, `m_1_2` Nachrichten-Anhang, `i_1_2_0` Bild). `itslearning_download_file` lädt sie:

| `mode` | Ergebnis |
|---|---|
| `auto` (Standard) | PDF/DOCX/Text → **geschwärzter Text**; Bilder → Bild; sonst Datei |
| `text` | nur geschwärzter Text |
| `blob` / `both` | Datei (bzw. Datei + Text) |

**Wichtig:** Bilder und Dateien (blob) werden inhaltlich nicht geschwärzt – nur extrahierter Text. Mit `DOWNLOAD_DIR` werden Dateien zusätzlich lokal abgelegt.

### Anrede der Lehrkräfte pflegen

Der Server trägt erkannte Lehrkräfte automatisch in `.data/teachers.json` ein (nur Nachname, keine Vornamen oder IDs):

```json
{ "teachers": [ { "id": "A3F2C1D0", "lastName": "Müller", "anrede": "" } ] }
```

`anrede` auf `"Frau"` oder `"Herr"` setzen → Agenten sehen „Frau Müller“. Leer → „Lehrkraft Müller“. Änderungen gelten ohne Neustart.

### In Claude Code einbinden

```bash
claude mcp add itslearning \
  -e ITSL_BASE_URL=https://meineschule.itslearning.com \
  -e ITSL_USERNAME=… -e ITSL_PASSWORD=… \
  -e DATA_DIR=/pfad/zu/itslearning-mcp/.data \
  -- bun run /pfad/zu/itslearning-mcp/src/server.ts
```

Docker-Betrieb folgt mit Meilenstein 4.

## Konfiguration

Siehe [`.env.example`](.env.example) und Spec, Abschnitt 3.

## Datenschutz (Stand M3)

| Wer | Anzeige |
|---|---|
| eigenes Konto | `Ich` |
| Lehrkraft | `Frau Müller` / `Lehrkraft Müller` (mit `REDACT_TEACHERS=true`: `Lehrkraft-A3F2`) |
| Mitschüler:in | `Schüler:in-7F3A` |
| Rolle unbekannt | `Person-7F3A` |

- Pseudonyme sind stabil (HMAC über die PersonId mit lokalem Secret).
- Namen in Freitexten (Aufgaben, Neuigkeiten, Nachrichten, Thread-Titel, Datei-Namen, extrahierte Datei-Texte) werden über ein Wörterbuch aller bekannten Personen ersetzt. Gefüllt wird es aus: Teilnehmer:innen der neuesten Unterhaltungen (beim Start), Kurs-Teilnehmer:innen (vor Kurs-Inhalten) und allen Personen in API-Antworten.
- E-Mail-Adressen, Telefonnummern und itslearning-interne Links (inkl. Download-Tokens) werden entfernt; externe Links bleiben.
- Tools geben nur ausgewählte Felder zurück, nie die Roh-Antwort der API.
- **Grenzen:** Namen von Personen, die in keinem Strukturfeld vorkamen (z. B. Eltern), werden in Texten nicht erkannt. Pseudonymisierung ist keine Anonymisierung.

## Entwicklung

```bash
bun run typecheck
bun test
```

`scripts/probe*.ts` sind die Erkundungs-Skripte aus der Analysephase (Report nur mit Struktur, ohne Inhalte).
