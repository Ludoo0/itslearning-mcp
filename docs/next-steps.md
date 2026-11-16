# Nächste Schritte (Stand 2026-11-17)

v1 (M1–M4) ist fertig und gepusht (`fc2e55b`). Der Smoke-Test gegen die echte Instanz meldet keine Leaks. Danach wurde der Server im Docker-Container als MCP-Server in Claude Code eingebunden und getestet. Daraus stammen die Punkte unten.

> Keine echten Namen, IDs oder Kurstitel in dieses Dokument schreiben – nur Muster beschreiben.

## 1. Fehler (zuerst beheben)

### 1.1 Extrahierter Datei-Text kommt beim Agenten nicht an
- **Symptom:** `itslearning_download_file` für ein PDF liefert `textIncluded: true`, aber der Agent (Claude Code) sieht nur die Metadaten.
- **Ursache:** Liefert ein Tool `structuredContent`, zeigt Claude Code offenbar **nur** diese an und ignoriert zusätzliche `text`-Content-Blöcke. Der Text steckt aber in einem eigenen Content-Block (`--- Inhalt (Text, geschwärzt) ---`).
- **Fix:** In `src/tools/files.ts` → `downloadFile()` den geschwärzten Text zusätzlich als Feld `text` in `structuredContent` (`meta`) aufnehmen. Den Content-Block beibehalten, für Clients ohne Unterstützung strukturierter Ausgabe. Für `kind: "page"` passt es bereits, dort steht der Text in den Daten.
- **Allgemein prüfen:** Gehen auch in anderen Tools Informationen nur über Text-Blöcke raus? Die Zusammenfassungen aus `ok()` gehen verloren, das ist aber unkritisch, weil alles auch in den Daten steht.
- **Test:** In `test/files.test.ts` sicherstellen, dass `structuredContent.text` den geschwärzten Text enthält.
- **Bilder** (`type: "image"`) kommen an, das passt.

## 2. Verbesserungen aus dem Praxistest

### 2.1 Überblick: uralte „überfällige“ Aufgaben ausblenden
- `itslearning_overview` listet als überfällig Aufgaben aus **Vorjahren** und aus Kursen, die nicht mehr aktiv sind (Status `NotStarted`, Frist teils Jahre her).
- **Vorschlag:** Im Überblick als `overdue` nur Aufgaben zeigen, deren Kurs in `courses/v1` (aktive Kurse) enthalten ist **und** deren Frist höchstens N Tage zurückliegt (Default 60, Parameter `overdueMaxAgeDays`). `itslearning_list_tasks` bleibt unverändert, dort ggf. Option `activeCoursesOnly`.

### 2.2 Zu viel geschwärzt bei Namen, die auch normale Wörter sind
- Beispiel-Muster: Ein Ortsadjektiv vor einem Veranstaltungsnamen („<Ort>er Nacht der Mathematik“) wurde durch `Schüler:in-XXXX` ersetzt, weil eine Person diesen Nachnamen hat. Das betrifft auch Dateinamen.
- **Vorschlag:** Neue Konfiguration `REDACTION_KEEP_WORDS` (kommagetrennt), deren Wörter nie als Einzelname ersetzt werden. Sie ergänzt `STOPWORDS` in `src/redaction/freetext.ts`. Konkrete Wörter **nicht** ins Repo schreiben (könnten auf die Schule schließen lassen), nur über `.env`/Compose setzen.
- Der Kompromiss gehört in die README: Ein Wort auf dieser Liste wird auch dann nicht ersetzt, wenn es tatsächlich die Person meint.

### 2.3 Titel von Gruppen-Unterhaltungen
- Ohne Thread-Namen wird der Titel aus Teilnehmer-Pseudonymen gebaut („Schüler:in-…, Schüler:in-…, Schüler:in-… +24“). Das sagt nichts aus.
- **Vorschlag** (`threadTitle()` in `src/tools/messages.ts`): Bei mehr als 3 Teilnehmenden → `Gruppe (N Teilnehmende)` plus beteiligte Lehrkräfte, z. B. `Gruppe (28) mit Lehrkraft X`. Einzelchats bleiben wie bisher.

### 2.4 `total: 0` bei Unterhaltungen und Nachrichten
- `messagethreads/v4` und `messages/v3` liefern `Total = 0`. Unser Feld `total` führt in die Irre.
- **Fix:** `total` nur ausgeben, wenn > 0, sonst weglassen. `hasMore` bleibt die maßgebliche Angabe. Betrifft `listThreads()` und `getThread()` (dort ist `hasMore` aktuell aus `Total` berechnet → bei `Total = 0` immer `false`; besser: `hasMore = msgs.length === limit`).

### 2.5 Aufgaben ohne Details (v1.1)
- Bei manchen Aufgaben (`LearningToolElement`, z. B. Wahl- oder Umfrage-Tools) verweigert `assignments/{id}/v1` den Zugriff → `detailsUnavailable: true`, ohne Aufgabenstellung.
- **Idee:** Ersatzweise die Element-Seite über den Download-Flow holen (`FileService`, `kind: "page"`) und den geschwärzten Seitentext als `text` liefern.

## 3. Danach

1. Nach den Fixes: `bun run typecheck`, `bun test`, `bun run smoke --details` (muss „keine Leaks“ melden).
2. Container neu bauen: `docker compose up -d --build`, Status `healthy` prüfen.
3. In Claude Code erneut testen. Der MCP-Server `itslearning` ist für dieses Projekt bereits eingetragen (HTTP, `127.0.0.1:3000/mcp`). Prüfen: PDF-Text kommt an, Überblick ohne Altlasten, Gruppentitel lesbar.
4. Commit + Push (vorher fragen, siehe Git-Regeln).

## 4. Weiter offen (aus Spec/API-Doku)

- Mapping `LearningToolId` → Elementtyp (Datei/Link/Seite/Test), damit `list_course_files` das vorab anzeigen kann.
- Abkürzung beim Kurs-Download: `DownloadRedirect.ashx` direkt mit `LearningObjectId`/`LearningObjectInstanceId` aus der Ressourcen-API (spart etwa 6 Requests pro Datei).
- Aufgaben-Anhänge (`a_…`-Referenzen) gegen einen echten Anhang verifizieren. Das Format von `Files[]` ist nur über die API-Doku bekannt.
- v2-Ideen: Eltern-Konten (`children/{childId}/…`), Kalender, Wochenpläne.
