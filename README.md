# itslearning-mcp

MCP-Server, der KI-Agenten **lesenden** Zugriff auf ein itslearning-Konto gibt – mit Schwärzung personenbezogener Daten.

- Spezifikation: [`docs/mcp-server-spec.md`](docs/mcp-server-spec.md)
- API-Erkenntnisse: [`docs/itslearning-api.md`](docs/itslearning-api.md)

## Status

| Meilenstein | Inhalt | Stand |
|---|---|---|
| M1 | Grundgerüst, Config, Login/Refresh, `list_courses`, `list_tasks`, `get_task`, stdio | ✅ |
| M2 | Personen-Registry, Lehrkräfte-Verzeichnis, Neuigkeiten, Bulletins, Nachrichten | ⏳ |
| M3 | Dateien (Download, Textextraktion, Cache) | ⏳ |
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

# Gegen das echte Konto testen (fragt URL, Benutzername und Passwort ab, Passwort verdeckt)
bun run call itslearning_list_tasks '{"limit":5}'
bun run call itslearning_list_courses
bun run call itslearning_get_task '{"elementId":123}'
```

Der Login-Status (rotierender Refresh-Token) liegt danach in `.data/state.json` – das Passwort wird nicht gespeichert.

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

## Datenschutz (Stand M1)

- Das eigene Konto erscheint in allen Texten als `Ich`.
- E-Mail-Adressen, Telefonnummern und itslearning-interne Links (inkl. Download-Tokens) werden aus Texten entfernt.
- Tools geben nur ausgewählte Felder zurück, nie die Roh-Antwort der API.
- **Noch nicht in M1:** Namen von Lehrkräften und Mitschüler:innen in Freitexten werden erst mit der Personen-Registry in M2 ersetzt.

## Entwicklung

```bash
bun run typecheck
bun test
```

`scripts/probe*.ts` sind die Erkundungs-Skripte aus der Analysephase (Report nur mit Struktur, ohne Inhalte).
