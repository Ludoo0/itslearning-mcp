# itslearning-MCP-Server – Spezifikation v1

Stand: 2026-11-16 · Status: Entwurf
Grundlage: [`itslearning-api.md`](./itslearning-api.md) (verifizierte Endpunkte, ✅ = getestet, ⏳ = noch offen)

---

## 1. Ziel und Scope

Ein MCP-Server, der KI-Agenten **lesenden** Zugriff auf ein itslearning-Konto gibt: Aufgaben, Neuigkeiten, Kurs-News, Nachrichten und Dateien. **Personenbezogene Daten werden geschwärzt**, bevor sie den Server verlassen.

| In v1 | Nicht in v1 (Nicht-Ziele) |
|---|---|
| Beliebige itslearning-Instanz (`ITSL_BASE_URL`) | Schreibende Aktionen (Nachrichten senden, Abgaben, Kommentare) |
| Schülerkonten mit nativem Login (Benutzername/Passwort) | Instanzen mit Login über einen fremden Anbieter (Microsoft/Google/IServ/Feide …) |
| Aufgaben, Neuigkeiten, Bulletins, Nachrichten, Dateien | Kalender (bei der Referenzinstanz ungenutzt; einfach nachrüstbar) |
| Betrieb als Docker-Container | Eltern-Konten. **v2**: Die API hat `children/{childId}/…`-Endpunkte |
| Ein Konto pro Container | Mehrere Konten pro Instanz (dafür einfach mehrere Container) |

**Grundsätze**

1. **Nur lesen.** Der Server ruft ausschließlich `GET`-Endpunkte auf, außerdem `POST /restapi/oauth2/token` für den Login.
2. **Allowlist statt Durchreichen.** Jedes Tool gibt ein eigenes, schlankes DTO zurück, nie die Roh-Antwort der API.
3. **Privacy by Default.** Unbekanntes wird geschwärzt; Geheimnisse (Tokens, signierte URLs) verlassen den Server nie.
4. **Schonend.** Caching, wenige parallele Anfragen, keine Hintergrund-Abfragen ohne Tool-Aufruf.

---

## 2. Architektur

```
┌──────────────┐  MCP (Streamable HTTP / stdio)  ┌─────────────────────────────────────────────┐
│  Agent/Client │ ─────────────────────────────▶ │ server ─▶ tools ─▶ redaction ─▶ DTOs         │
└──────────────┘                                 │              │                               │
                                                 │              ▼                               │
                                                 │   api (REST, Bearer) ◀── auth (TokenStore)   │
                                                 │   websession (SSO → Cookies → Download)      │
                                                 │   cache (RAM + /data/files)  files (Text)    │
                                                 └──────────────────────┬──────────────────────┘
                                                                        ▼
                                                     https://<instanz>.itslearning.com
```

**Stack:** Bun ≥ 1.4, TypeScript (strict), `@modelcontextprotocol/sdk` (Streamable HTTP + stdio), `zod` (Eingabe-Schemas). Textextraktion mit `unpdf` (PDF) und `mammoth` (DOCX).

**Module (`src/`)**

| Modul | Aufgabe | Übernommen aus |
|---|---|---|
| `config.ts` | Umgebungsvariablen + `*_FILE`-Secrets lesen und validieren (zod) | – |
| `auth/tokenStore.ts` | Login, Refresh, Persistenz, Mutex | `scripts/lib.ts` (`loginWithPassword`, `refreshToken`) |
| `api/client.ts` | REST-GET mit Bearer, Rate-Limit, Retry, Fehler-Mapping | `scripts/lib.ts` (`ItslearningClient`) |
| `api/endpoints.ts` | Typisierte Aufrufe pro Endpunkt + `entities()`-Helfer (für verschachtelte Listen) | `scripts/probe2.ts` (`entities`) |
| `websession/` | SSO-URL → Cookie-Jar → Element-Seite → iframe → `DownloadRedirect` | `scripts/probe2.ts` (`CookieJar`, `browse`, `extractLinks`, `describeFile`) |
| `redaction/` | Personenauflösung, Pseudonyme, Lehrkräfte-Verzeichnis, Freitext-Ersetzung, Geheimnis-Filter | `scripts/probe2.ts` (`redactUrl`, `sanitizeError`) |
| `files/` | fileRef-Registry, Download-Cache, Textextraktion | – |
| `tools/` | Ein File pro Tool: zod-Schema, Handler, DTO-Mapping | – |
| `server.ts` | MCP-Server, Transport (HTTP/stdio), `/healthz`, API-Key-Prüfung | – |
| `log.ts` | Strukturiertes Logging mit Pflicht-Schwärzung | – |

---

## 3. Konfiguration

Alle Werte kommen aus Umgebungsvariablen. Für Geheimnisse gibt es jeweils eine `*_FILE`-Variante (Docker-Secrets); ist sie gesetzt, hat sie Vorrang.

| Variable | Pflicht | Default | Beschreibung |
|---|---|---|---|
| `ITSL_BASE_URL` | ✅ | – | z. B. `https://meineschule.itslearning.com` (ohne `/` am Ende) |
| `ITSL_USERNAME` / `_FILE` | ✅ | – | itslearning-Benutzername |
| `ITSL_PASSWORD` / `_FILE` | ✅ | – | itslearning-Passwort |
| `ITSL_CLIENT_ID` | | `10ae9d30-1853-48ff-81cb-47b58a325685` | OAuth-Client-ID (öffentliche ID der Mobile-App) |
| `MCP_TRANSPORT` | | `stdio` (Docker-Image: `http`) | `http` (Streamable HTTP) oder `stdio` |
| `MCP_HOST` | | `127.0.0.1` (Docker-Image: `0.0.0.0`) | Bind-Adresse für HTTP |
| `MCP_PORT` | | `3000` | Port für HTTP |
| `MCP_ALLOWED_ORIGINS` | | leer | Erlaubte Browser-Origins (kommagetrennt); Anfragen mit anderem `Origin`-Header → 403 (DNS-Rebinding-Schutz) |
| `MCP_API_KEY` / `_FILE` | ✅ bei `http` | – | Bearer-Key, den Clients senden müssen (≥ 32 Zeichen) |
| `REDACTION_SECRET` / `_FILE` | | auto | HMAC-Secret für Pseudonyme. Fehlt es, wird es einmalig erzeugt und in `/data/secret` gespeichert |
| `REDACT_TEACHERS` | | `false` | `true` → Lehrkräfte ebenfalls pseudonymisieren (`Lehrkraft-XXXX`) |
| `TEACHER_ROLE_TITLES` | | `Lehrer,Lehrerin,Lehrkraft,Teacher,Mitarbeiter,Staff` | Werte von `RoleInHierarchyTitle`, die als Lehrkraft gelten ⏳ |
| `DOWNLOAD_DIR` | | – | Optional: heruntergeladene Dateien zusätzlich hier ablegen (geschwärzter Dateiname) |
| `MAX_FILE_MB` | | `25` | Größere Dateien werden abgelehnt |
| `CACHE_TTL_S` | | `60` | Gültigkeit des Listen-Caches |
| `MAX_CONCURRENCY` | | `2` | Parallele Anfragen an itslearning |
| `MIN_REQUEST_INTERVAL_MS` | | `200` | Mindestabstand zwischen Anfragen |
| `DATA_DIR` | | `/data` | Persistenz (State, Lehrkräfte, Datei-Cache) |
| `LOG_LEVEL` | | `info` | `debug` \| `info` \| `warn` \| `error` |

Ungültige Konfiguration → Start bricht mit verständlicher Fehlermeldung ab, ohne Secrets auszugeben.

---

## 4. Authentifizierung und Session

### 4.1 Login und Start-Check

1. Beim Start: Der Server liest `state.json` (falls vorhanden) und versucht einen Refresh.
2. Fehlt `state.json` oder schlägt der Refresh fehl: Login per Passwort (`grant_type=password`).
3. **Kompatibilitäts-Check** bei Fehlschlag:
   - `401 InvalidUser` → „Benutzername oder Passwort falsch“.
   - Andere Fehler → Der Server ruft die Login-Seite der Instanz auf und prüft, ob die Seite nur den Login über einen fremden Anbieter anbietet (`federatedLogin` ohne `nativeLogin`). Dann meldet er: „Diese Instanz verwendet Single Sign-on über einen fremden Anbieter; das wird in v1 nicht unterstützt.“
4. Danach `GET /restapi/personal/person/v1` → `PersonId` des eigenen Kontos (für „Ich“) und Prüfung der Berechtigungs-Flags (`CanAccessCourses`, `CanAccessInstantMessageSystem`). Fehlende Berechtigungen deaktivieren die betroffenen Tools mit Hinweis.

### 4.2 Token-Lebenszyklus

- Access-Token gilt 300 s → **proaktiver Refresh 30 s vor Ablauf**.
- **Der Refresh-Token ändert sich bei jedem Refresh.** Den neuen Token speichert der Server sofort und atomar (in eine temporäre Datei schreiben, dann umbenennen) in `DATA_DIR/state.json` (Rechte `0600`):
  ```json
  { "baseUrl": "...", "username": "...", "refreshToken": "...", "updatedAt": "..." }
  ```
  `baseUrl`/`username` passen nicht zur aktuellen Konfiguration → State verwerfen.
- **Mutex:** Es läuft höchstens ein Refresh gleichzeitig; parallele Anfragen warten auf dessen Ergebnis.
- Refresh schlägt fehl (z. B. widerrufen) → einmal Login per Passwort; schlägt auch das fehl → Tool-Fehler `AUTH_FAILED`.
- `401` auf einer API-Anfrage → einmal Refresh und Wiederholung, dann Fehler.

### 4.3 Web-Session (nur für Kurs-Dateien)

- Wird bei Bedarf aufgebaut über `GET /restapi/personal/sso/url/v1?url=<ContentUrl>` (siehe `itslearning-api.md` → Dateien, Weg 2).
- Ein Cookie-Jar pro Prozess, nur für `*.itslearning.com`. Nach 20 min Inaktivität oder bei einer Login-Seite im Ergebnis → neu aufbauen.
- Höchstens ein Session-Aufbau gleichzeitig (Mutex).

---

## 5. Tools

Konventionen:
- Namen mit Präfix `itslearning_`. Alle Tools sind mit `readOnlyHint: true` annotiert.
- IDs (Kurs, Aufgabe, Thread) sind die numerischen itslearning-IDs. Sie sind kein Klartext-Personenbezug und werden für Folgeaufrufe gebraucht. **Ausnahme:** `PersonId` wird nie ausgegeben.
- **Dateien** werden nur über ein opaques `fileRef` referenziert (siehe 5.10).
- Zeiten im Format ISO 8601 mit Zeitzone, dazu eine Variante in der Zeitzone des Kontos (`TimeZoneId` aus Person).
- Listen haben `limit` (Default 20, max. 100) und geben `hasMore` zurück.
- Ausgabe: `structuredContent` (JSON) und zusätzlich eine kurze Text-Zusammenfassung für Clients ohne Unterstützung für strukturierte Ausgabe.

Gemeinsame Typen:

```ts
type Person = {
  display: string;              // "Frau Müller" | "Lehrkraft Müller" | "Schüler:in-7F3A" | "Ich"
  role: "teacher" | "student" | "self" | "unknown";
};
type CourseRef = { courseId: number; title: string };
type FileRef = {
  fileRef: string;              // opak, z. B. "f_9c1e…", nur auf diesem Server gültig
  name: string;                 // geschwärzter Dateiname
  kind: "file" | "image" | "link" | "unknown";
};
```

### 5.1 `itslearning_overview`

Einstieg für Agenten: „Was ist los?“

| | |
|---|---|
| Eingabe | `{ days?: number = 7, newsSince?: string (ISO-Datum) = jetzt − 7 Tage }` |
| Ausgabe | `{ dueSoon: Task[], overdue: Task[], news: NewsItem[], unreadThreads: number }` |
| Endpunkte | `tasks/v1`, `notifications/stream/v2?showLightBulletins=true`, `instantmessages/messagethreads/v4` |

`unreadThreads` wird aus `LastReadInstantMessageId < LastMessage.MessageId` berechnet, weil die Zähler-Endpunkte nicht existieren (404).

### 5.2 `itslearning_list_courses`

| | |
|---|---|
| Eingabe | `{ includeInactive?: boolean = false, starredOnly?: boolean = false }` |
| Ausgabe | `{ courses: { courseId, title, code?, lastUpdated, newNotifications, newBulletins, starred }[] }` |
| Endpunkte | `courses/v1` (aktiv), `courses/v2` (bei `includeInactive`, zusätzlich `active=false`), `courses/cards/starred/v1` |

### 5.3 `itslearning_list_tasks`

| | |
|---|---|
| Eingabe | `{ courseId?: number, status?: "open" \| "all" = "open", dueWithinDays?: number, homeworkOnly?: boolean, limit? }` |
| Ausgabe | `{ tasks: Task[], hasMore }` |
| Endpunkte | `tasks/v1` bzw. `courses/{courseId}/tasks/v1` ✅ |

```ts
type Task = {
  taskId: number; elementId: number; title: string;
  course: string;                     // LocationTitle
  courseId?: number;                  // LocationId, wenn LocationType = Course
  deadline: string | null; status: string; homework: boolean;
  type: "assignment" | "activity" | "other";  // LearningToolElement | CustomActivity | sonst
  descriptionPreview?: string;        // geschwärzt, max. 300 Zeichen
};
```

### 5.4 `itslearning_get_task`

| | |
|---|---|
| Eingabe | `{ elementId: number }` |
| Ausgabe | `Task & { text: string /* geschwärzt, HTML→Markdown */, submissionType, completionMode, mandatory, lateSubmissionAllowed, hasAnswer, canSubmit, files: FileRef[] }` |
| Endpunkte | `assignments/{elementId}/v1` ✅. Bei `403` (CustomActivity) → nur Basisdaten aus der Aufgabenliste + Hinweis `detailsUnavailable: true` |

`files` entsteht aus `Files[]`/`TemplateFile` → fileRef über `assignments/{id}/files/{fileId}/v1` ⏳.

### 5.5 `itslearning_list_news`

| | |
|---|---|
| Eingabe | `{ courseId?: number, since?: string, limit? }` |
| Ausgabe | `{ items: NewsItem[], hasMore }` |
| Endpunkte | `notifications/stream/v2?showLightBulletins=true` ✅ bzw. `courses/{id}/stream/v1?showLightBulletins=true` ✅ |

```ts
type NewsItem = {
  id: number; published: string; course: string; author: Person;
  text: string;                 // geschwärzt
  kind: "bulletin" | "element" | "other";
  elementId?: number;           // z. B. neue Ressource/Aufgabe → weiterführendes Tool
  attachments: FileRef[];       // Bilder des Light Bulletins
};
```

### 5.6 `itslearning_list_bulletins`

| | |
|---|---|
| Eingabe | `{ courseId: number, limit? }` |
| Ausgabe | `{ bulletins: { id, published, author: Person, text, pinned, link?: string, images: FileRef[], resources: FileRef[], commentsCount }[], hasMore }` |
| Endpunkte | `courses/{id}/bulletins/v1` ✅, für `HasResources` zusätzlich `courses/bulletins/{id}/elements/v1` ✅ |

`link` (`EmbedUrl`) wird nur ausgegeben, wenn es eine externe URL ohne Personenbezug ist (keine itslearning-Profil- oder Session-URL).

### 5.7 `itslearning_list_message_threads`

| | |
|---|---|
| Eingabe | `{ limit?, unreadOnly?: boolean = false, type?: "OneToOne" \| "Group" \| "Course" }` |
| Ausgabe | `{ threads: { threadId, title, type, participants: Person[], participantsCount, lastMessage: { at, from: Person, preview }, unread }[], hasMore }` |
| Endpunkte | `instantmessages/messagethreads/v4` ✅ |

`title`: Thread-Namen sind oft Personennamen → durch das Namens-Wörterbuch ersetzen. Ist der Name leer, wird ein Titel aus den Teilnehmer-Displays gebildet (`"Frau Müller, Ich"`). Bei mehr als 5 Teilnehmern gibt der Server nur Lehrkräfte + `participantsCount` aus.

### 5.8 `itslearning_get_message_thread`

| | |
|---|---|
| Eingabe | `{ threadId: number, limit? = 30, beforeMessageId?: number }` |
| Ausgabe | `{ threadId, title, messages: { messageId, at, from: Person, text, edited, deleted, system, attachment?: FileRef }[], hasMore }` |
| Endpunkte | `instantmessages/messagethreads/{id}/messages/v3?pageSize=&fromId=` ✅ |

### 5.9 `itslearning_list_course_files`

| | |
|---|---|
| Eingabe | `{ courseId: number, folderId?: number, recursive?: boolean = false, maxDepth?: number = 3 }` |
| Ausgabe | `{ items: { elementId, title, kind: "folder" \| "file" \| "link" \| "page" \| "test" \| "unknown", path, homework, active, fileRef?: string }[] }` |
| Endpunkte | `courses/{id}/resources/v1` ✅, `courses/{id}/folders/{folderId}/resources/v1` ✅ |

`kind` aus `ElementType` (`Folder`) bzw. Mapping von `LearningToolId` ⏳. Solange das Mapping fehlt, erhält jedes `LearningToolElement` ein `fileRef` mit `kind: "unknown"`, und erst `download_file` stellt fest, ob es eine Datei ist. Rekursion höchstens bis `maxDepth` und mit einem harten Limit von 300 Elementen.

### 5.10 `itslearning_download_file`

| | |
|---|---|
| Eingabe | `{ fileRef: string, mode?: "auto" | "text" | "blob" | "both" = "auto", maxTextChars?: number = 50000 }` |
| Ausgabe | `structuredContent: { fileRef, kind, name, mimeType, sizeBytes, cached, textIncluded, textChars?, textTruncated?, blobIncluded, savedTo? }` + Content-Blöcke: Text (geschwärzt) und/oder `image` bzw. `resource` (`blob`, base64) |
| `mode=auto` | PDF/DOCX/Text → nur geschwärzter Text (Datenschutz-Default, spart Tokens) · Bilder → `image` · sonst → `resource` |
| Wege | (a) filerepository-URL direkt ✅ · (b) Kurs-Element über Web-Session → `DownloadRedirect.ashx` ✅ · (c) `assignments/{id}/files/{fileId}/v1` ⏳ |

**fileRefs** (`files/refs.ts`, umgesetzt in M3): Referenzen enthalten nur itslearning-IDs (keine Geheimnisse) und sind **zustandslos auflösbar**, also auch nach einem Neustart gültig:

| fileRef | Quelle | Auflösung |
|---|---|---|
| `e_<elementId>` | Kurs-Element | `courses/resources/{id}/v1` → SSO → Web-Session → `DownloadRedirect` |
| `a_<elementId>_<fileId>` | Aufgaben-Anhang | `assignments/{id}/files/{fileId}/v1` (302) |
| `m_<threadId>_<messageId>` | Nachrichten-Anhang | `AttachmentUrl` (aus Speicher oder durch erneutes Laden des Threads) |
| `i_<courseId>_<bulletinId>_<n>` | Bulletin-Bild | `OriginalFileUrl` (aus Speicher oder durch erneutes Laden der Bulletins) |

Die geheimen URLs werden nur im Speicher des FileService gehalten. Ein unbekanntes Format bzw. ein nicht mehr auffindbarer Anhang → `FILE_REF_UNKNOWN`. Der Server nutzt ausschließlich die Rechte des Kontos, ein selbst gebautes fileRef gibt also keinen zusätzlichen Zugriff.

**Verhalten:**
- Größer als `MAX_FILE_MB` → Fehler `FILE_TOO_LARGE`, ohne Download.
- Ergebnis ist keine Datei (HTML ohne Download-Link, z. B. Link, Notiz oder Test) → `{ kind: "page", title, text }` mit geschwärztem Seitentext, aber **keine URL**.
- **Vor dem Download** registriert der Server alle Personen, die im Dokument stehen könnten: Kurs-Teilnehmer:innen (`courses/{id}/participants/v1` ⏳, best effort) bzw. Thread-Teilnehmer:innen.
- Optional `DOWNLOAD_DIR`: Datei wird zusätzlich als `<fileRef>_<geschwärzter Name>` abgelegt (`savedTo`).
- Cache: `DATA_DIR/files/<sha256(fileRef)>` + Metadaten; gültig, solange `LastUpdated` des Elements unverändert ist (bei direkten URLs: 24 h).
- Textextraktion: PDF (`unpdf`), DOCX (`mammoth`), `text/*`, Markdown. Andere Typen nur als Blob. Danach läuft der Text durch die Freitext-Schwärzung (6.4).
- Dateiname: Wörterbuch-Ersetzung + Regex. Die Endung bleibt erhalten.
- **Bekannte Grenze:** Den Inhalt der Datei im Blob schwärzt der Server nicht. Eine PDF-Datei kann also Namen enthalten. Das steht in der Tool-Beschreibung, damit der Client bzw. Nutzer das weiß. Deshalb liefert `mode=auto` für PDF/DOCX/Text standardmäßig **nur den geschwärzten Text**; die Datei selbst gibt es nur bei Bildern, nicht extrahierbaren Formaten oder ausdrücklich mit `mode=blob|both`.

---

## 6. Schwärzung

Kernkapitel. Implementiert in `src/redaction/`, vollständig unit-getestet.

### 6.1 Personen-Registry

Jede Person, die in einer API-Antwort auftaucht, wird über ihre `PersonId` registriert. Quellen:

| Quelle | Felder | Rolle |
|---|---|---|
| `person/v1` | eigene `PersonId` | `self` |
| Thread-`Participants[]` | `PersonId, FirstName, LastName, FullName, RoleInHierarchyTitle` | aus `RoleInHierarchyTitle` (`TEACHER_ROLE_TITLES`) |
| Nachrichten | `CreatedBy` (ID), `CreatedByName`, `CreatedByShortName` | aus Teilnehmerliste / Thread-`CreatedByTeacher` |
| `PublishedBy` (Stream, Bulletins, Newsfeed) | `PersonId, FirstName, LastName, FullName` | **Bulletins:** `teacher` (Annahme ⏳: Bulletins posten in der Regel nur Lehrkräfte. Gilt nur, wenn die Person nicht anderswo als Schüler:in erkannt wurde) · sonst bisherige Rolle bzw. `unknown` |

Rollenregeln:
- Wurde eine Person einmal sicher als Lehrkraft erkannt, bleibt sie Lehrkraft, auch über Neustarts (gespeichert in `teachers.json`).
- `unknown` wird **wie `student` geschützt** (Pseudonym), aber als `Person-XXXX` angezeigt.
- **Vorwärmen:** Nach dem Login lädt der Server einmalig die neuesten 50 Unterhaltungen und registriert deren Teilnehmer:innen, damit deren Namen auch in Aufgaben- und Neuigkeiten-Texten erkannt werden.
- `Frau/Herr <Nachname>`-Varianten kommen nur für Lehrkräfte ins Wörterbuch (sonst Kollisionen mit gleichnamigen Schüler:innen). Mehrdeutige Schreibweisen (zwei Personen, gleicher Name) werden zu `[Name]`.

### 6.2 Anzeige

| Rolle | Anzeige | Beispiel |
|---|---|---|
| `self` | `Ich` | `Ich` |
| `teacher` (Anrede gepflegt) | `<Anrede> <Nachname>` | `Frau Müller` |
| `teacher` (Anrede leer) | `Lehrkraft <Nachname>` | `Lehrkraft Müller` |
| `teacher` mit `REDACT_TEACHERS=true` | `Lehrkraft-<hash4>` | `Lehrkraft-A3F2` |
| `student` | `Schüler:in-<hash4>` | `Schüler:in-7F3A` |
| `unknown` | `Person-<hash4>` (gleich geschützt wie Schüler:innen, aber ohne falsche Rollenbehauptung) | `Person-7F3A` |

`hash4` = die ersten 4 Hex-Zeichen von `HMAC-SHA256(REDACTION_SECRET, baseUrl + PersonId)`, großgeschrieben. Bei Kollisionen innerhalb der Registry wird der Wert auf 6 Zeichen verlängert. Das Pseudonym bleibt über Neustarts gleich.

**Lehrkräfte-Verzeichnis `DATA_DIR/teachers.json`:** Der Server legt es automatisch an und ergänzt es; der Nutzer pflegt die Anrede:

```json
{
  "_hinweis": "anrede eintragen: \"Frau\", \"Herr\" oder leer lassen (→ \"Lehrkraft <Nachname>\")",
  "teachers": [
    { "id": "A3F2", "lastName": "Müller", "anrede": "Frau" },
    { "id": "B71C", "lastName": "Schmidt", "anrede": "" }
  ]
}
```

- `id` ist das Pseudonym (keine `PersonId` in der Datei). Vornamen werden **nicht** gespeichert.
- Der Server lädt die Datei neu, wenn sie sich ändert (Watch auf Änderungszeit). Ein Neustart ist nicht nötig.
- **Keine Ableitung der Anrede aus dem Vornamen.** Die API liefert kein Geschlecht, und Raten wäre fehleranfällig.

### 6.3 Strukturfelder (DTO-Allowlist)

DTOs enthalten Personen nur als `Person` (6.2). Nie ausgegeben werden: `PersonId`, `FirstName`, `LastName`, `FullName`, `CreatedByName`, `CreatedByShortName`, `ProfileUrl`, `ProfileImageUrl*`, `CreatedByAvatar`, `HomeOrganization`, `AdditionalInfo`, `ExtraUserInformation`, `iCalUrl*`, sowie alle URLs außer den in 6.5 erlaubten.

### 6.4 Freitext

Gilt für: `Text`, `RawText`, `Description`, Thread-Namen, `AttachmentName`, `LinkTitle`, `LocationRecipients[].Title`, Dateinamen, extrahierte Dateitexte.

Pipeline (Reihenfolge wichtig):
1. **HTML → Markdown** (einfacher Konverter; `<a href>` wird zu `[Text](erlaubte URL)` oder nur `Text`).
2. **Geheimnis-Filter** (6.5) auf alle URLs im Text.
3. **Namens-Wörterbuch:** Aus der Registry werden für jede Person Ersetzungen gebaut:
   - `FullName`, `Vorname Nachname`, `Nachname, Vorname`, `CreatedByShortName` → Anzeige der Person
   - `Anrede Nachname` (z. B. „Frau Müller“) → Anzeige der Person (bei Lehrkräften identisch, bei `REDACT_TEACHERS` Pseudonym)
   - Einzelner **Nachname** → Anzeige; einzelner **Vorname** → Anzeige, aber nur, wenn er ≥ 3 Zeichen hat und kein häufiges deutsches Wort ist (kleine Stoppliste, z. B. „Mai“, „Rose“, „Klein“, „Wolf“ …)
   - Wortgrenzen-basiert, ohne Beachtung von Groß-/Kleinschreibung, Unicode-fähig (`\p{L}`), längste Treffer zuerst
4. **Regex:**
   - E-Mail → `[E-Mail]`
   - Telefonnummern (≥ 7 Ziffern mit Trennzeichen) → `[Telefon]`
   - itslearning-Profil-URLs → entfernt
   - `@Mentions` → über das Wörterbuch auflösen, sonst `@[Person]`
5. **Begrenzung der Länge** je nach Tool.

Das eigene Konto (`self`) wird ebenfalls ersetzt (`Ich`), damit der Klarname des Kindes nie herausgeht.

### 6.5 Geheimnisse und URLs

**Nie ausgeben, nie loggen:**
- Access- und Refresh-Token, Passwort
- `iCalUrl`
- SSO-URLs (`MobileAppLoginSso`, `ProcessLogin`, `LoginSSO.aspx`), `File/View.aspx`- und `ViewFile.aspx`-URLs (die enthalten Name, E-Mail und Benutzername als Query-Parameter)
- `filerepository.itslearning.com/…?Token=` und signierte `filecache`-URLs
- Alle Query-Parameter namens `Token`, `Signature`, `Hash`, `sign`, `ApiSessionId`, `Guid`

**Erlaubte URLs in Ausgaben:**
- Externe Links aus Inhalten (z. B. `EmbedUrl`, Links in Texten), sofern sie nicht auf `*.itslearning.com` zeigen und keine der oben genannten Parameter enthalten. Begründung: Sie sind Inhalt (z. B. Arbeitsblatt-Link) und für Agenten nützlich.
- Keine itslearning-Deep-Links. Agenten nutzen IDs + Tools.

### 6.6 Logging

- Der Logger ersetzt vor der Ausgabe die Werte bekannter Geheimnisse (aktuelle Tokens, Passwort, API-Key) und wendet `redactUrl`/`sanitizeError` an.
- Inhalte (Texte, Namen) werden auch auf `debug` nicht geloggt, nur Endpunkt-Template, Status und Dauer.

### 6.7 Grenzen (in der README zu dokumentieren)

- Namen, die in keinem Strukturfeld vorkamen (z. B. Eltern, Personen außerhalb der Kurse), werden in Freitexten nicht erkannt.
- Namen in Bildern, Scans und im Datei-Blob werden nicht geschwärzt.
- Pseudonymisierung ist keine Anonymisierung (DSGVO). Die Schwärzung senkt das Risiko, ersetzt aber nicht die Entscheidung, welche Daten an ein Cloud-LLM gehen.

---

## 7. Caching und Schonung von itslearning

| Was | Wie |
|---|---|
| Listen (Kurse, Aufgaben, Stream, Threads …) | RAM-Cache, Schlüssel = Endpunkt + Parameter, TTL `CACHE_TTL_S` (60 s) |
| Person, Kursliste | TTL 15 min |
| Dateien | Festplatten-Cache in `DATA_DIR/files`, max. 500 MB, LRU |
| Parallelität | höchstens `MAX_CONCURRENCY` (2) Anfragen gleichzeitig, mindestens `MIN_REQUEST_INTERVAL_MS` (200 ms) Abstand |
| Retry | `429`/`5xx`/Netzwerkfehler: 3 Versuche, exponentielles Backoff (0,5 s → 1 s → 2 s), `Retry-After` beachten |
| Paging | `limit` wird auf API-`PageSize` abgebildet; keine automatischen Voll-Abrufe über alle Seiten |
| Hintergrund | keine Abfragen ohne Tool-Aufruf |

---

## 8. Transport und Betrieb (Docker)

### 8.1 Transport

- **`http`:** MCP Streamable HTTP unter `POST /mcp`, **zustandslos** mit JSON-Antworten (kein SSE, keine Sessions; `GET`/`DELETE` → 405). Pro Anfrage ein frischer `McpServer` über dem gemeinsamen Kontext – Login, Caches und Personen-Registry bleiben erhalten. Umgesetzt mit dem Web-Standard-Transport des SDK direkt auf `Bun.serve` (Body-Limit 1 MB).
  - Jeder Request braucht `Authorization: Bearer <MCP_API_KEY>`. Der Vergleich läuft zeitkonstant (`timingSafeEqual`).
  - `GET /healthz` ohne Auth → `200 {"status":"ok"}` (keine Details).
  - Kein TLS im Container. Für Zugriff von außerhalb von localhost: Reverse-Proxy (Caddy/Traefik) mit TLS davor. In der Compose-Vorlage ist der Port standardmäßig an `127.0.0.1` gebunden.
- **`stdio`:** für lokale Clients über `docker run -i --rm …`. Kein API-Key nötig.

### 8.2 Dockerfile (Skizze – umgesetzt in `Dockerfile`: ohne Bundling, da unpdf/mammoth dynamisch geladen werden; Image ~220 MB)

```dockerfile
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
RUN bun build src/server.ts --target=bun --outdir=dist

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
ENV MCP_TRANSPORT=http MCP_PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["bun", "dist/server.js"]
```

### 8.3 `compose.yaml` (Vorlage – umgesetzt in `compose.yaml`, Secrets-Vorlagen in `secrets.example/`)

```yaml
services:
  itslearning-mcp:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      ITSL_BASE_URL: https://meineschule.itslearning.com
      ITSL_USERNAME_FILE: /run/secrets/itsl_username
      ITSL_PASSWORD_FILE: /run/secrets/itsl_password
      MCP_API_KEY_FILE: /run/secrets/mcp_api_key
    secrets: [itsl_username, itsl_password, mcp_api_key]
    volumes:
      - itsl-data:/data
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]

secrets:
  itsl_username: { file: ./secrets/itsl_username }
  itsl_password: { file: ./secrets/itsl_password }
  mcp_api_key:   { file: ./secrets/mcp_api_key }

volumes:
  itsl-data:
```

`teachers.json` pflegen: `docker compose exec itslearning-mcp vi /data/teachers.json`. Alternativ wird `/data` als Bind-Mount eingebunden.

### 8.4 Client-Konfiguration (Beispiele)

Claude Code über HTTP:
```bash
claude mcp add --transport http itslearning http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $(cat secrets/mcp_api_key)"
```

Claude Desktop über stdio (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "itslearning": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "C:/pfad/itslearning.env",
               "-e", "MCP_TRANSPORT=stdio", "-v", "itsl-data:/data", "itslearning-mcp"]
    }
  }
}
```

---

## 9. Fehlerbehandlung

Tool-Fehler werden als MCP-Ergebnis mit `isError: true` und strukturiertem Code zurückgegeben:

| Code | Auslöser | Meldung an den Agenten |
|---|---|---|
| `AUTH_FAILED` | Login/Refresh endgültig fehlgeschlagen | „Anmeldung bei itslearning fehlgeschlagen – Zugangsdaten prüfen.“ |
| `SSO_NOT_SUPPORTED` | Instanz ohne nativen Login | siehe 4.1 |
| `FORBIDDEN` | `403` | „Kein Zugriff auf dieses Element.“ |
| `NOT_FOUND` | `404` | „Element nicht gefunden.“ |
| `RATE_LIMITED` | `429` nach Retries | „itslearning drosselt Anfragen – später erneut versuchen.“ |
| `UPSTREAM_ERROR` | `5xx`/Netzwerk nach Retries | „itslearning ist nicht erreichbar.“ |
| `FILE_REF_UNKNOWN` | unbekanntes `fileRef` | „Datei-Referenz unbekannt – Liste erneut abrufen.“ |
| `FILE_TOO_LARGE` | > `MAX_FILE_MB` | mit Größe |
| `NOT_A_FILE` | Download-Flow ergibt keine Datei | mit `kind` |
| `INVALID_INPUT` | zod-Validierung | mit Feldnamen |

Rohe Fehlertexte der API (sie enthalten IDs wie `PersonId=…`) werden **nie** durchgereicht, sondern nur bereinigt geloggt (`sanitizeError`).

---

## 10. Projektstruktur

```
itslearning-mcp/
├─ src/
│  ├─ server.ts            # Einstieg, Transport, /healthz, API-Key
│  ├─ config.ts
│  ├─ log.ts
│  ├─ auth/tokenStore.ts
│  ├─ api/{client,endpoints,types}.ts
│  ├─ websession/{cookieJar,browse,downloadFlow}.ts
│  ├─ redaction/{registry,display,teachers,freetext,secrets,html}.ts
│  ├─ files/{registry,cache,extract}.ts
│  └─ tools/{overview,courses,tasks,news,bulletins,messages,files}.ts
├─ test/
│  ├─ fixtures/            # synthetische API-Antworten (Struktur wie im echten Report, Fantasie-Namen)
│  └─ *.test.ts
├─ scripts/                # bestehende Probe-Skripte (bleiben als Debug-Werkzeug)
├─ docs/
├─ Dockerfile
├─ compose.yaml
├─ .env.example
└─ README.md
```

---

## 11. Tests und Abnahme

### 11.1 Unit-Tests (`bun test`, ohne Netzwerk)

- **Fixtures:** synthetische Antworten für alle genutzten Endpunkte. Die Struktur folgt den Schemas aus `probe-output/report2.json`, die Namen sind ausgedacht.
- **Schwärzung:**
  - Kein Vor- oder Nachname aus den Fixtures (außer Lehrkräfte-Nachnamen) taucht in einer Tool-Ausgabe auf.
  - Pseudonyme bleiben bei gleichem Secret stabil und ändern sich bei anderem Secret.
  - `teachers.json`: Anrede wird übernommen; leer → „Lehrkraft X“; `REDACT_TEACHERS` → Pseudonym.
  - Freitext: Vollname, „Nachname, Vorname“, Kurzname, „Frau Nachname“, E-Mail, Telefon, Profil-URL.
  - Fehlalarme: Stoppwörter und Vornamen < 3 Zeichen bleiben stehen.
  - Geheimnis-Filter: keine `Token=`, `Signature=`, `filecache`, `LoginSSO`, `iCal`-URLs in der Ausgabe.
- **Auth:** Refresh 30 s vor Ablauf; der rotierende Refresh-Token wird gespeichert; paralleler Refresh nur einmal; Rückfall auf Passwort.
- **fileRef:** stabil, unbekannt → `FILE_REF_UNKNOWN`, keine URL in der Ausgabe.

### 11.2 Smoke-Test gegen eine echte Instanz (`bun run smoke`)

- Ruft jedes Tool einmal auf (Download: erste gefundene Datei).
- **Leak-Prüfung** auf allen Ausgaben:
  - Kein Name aus der Personen-Registry, außer erlaubten Lehrkräfte-Nachnamen
  - Kein `@`, keine `Token=`/`Signature=`
  - Kein Host `filecache`/`filerepository`
- Gibt nur Bestanden oder Nicht bestanden und die Anzahl aus, keine Inhalte.

### 11.3 Abnahmekriterien v1

- [ ] Alle Tools aus 5 liefern Daten gegen die Referenzinstanz.
- [ ] Unit-Tests grün, Smoke-Test ohne Leak.
- [ ] Neustart des Containers ohne erneute Passwort-Prüfung (Refresh-Token aus `state.json`), Token-Erneuerung über > 1 h stabil.
- [ ] `docker compose up` mit einer anderen `ITSL_BASE_URL` startet und meldet entweder Erfolg oder einen klaren Fehler (z. B. SSO).
- [ ] Image läuft nicht als root, Dateisystem schreibgeschützt bis auf `/data` und `/tmp`.

---

## 12. Meilensteine

| # | Inhalt | Ergebnis |
|---|---|---|
| M1 | Grundgerüst, Config, Auth/TokenStore, API-Client, `list_courses`, `list_tasks`, `get_task`, stdio-Transport | Erste Tools in Claude Code nutzbar |
| M2 | Personen-Registry, Lehrkräfte-Verzeichnis, Freitext-Schwärzung, `overview`, `list_news`, `list_bulletins`, Nachrichten-Tools | Alle Lese-Tools außer Dateien, mit Schwärzung |
| M3 | fileRef-Registry, Web-Session, `list_course_files`, `download_file`, Textextraktion, Datei-Cache | Dateien |
| M4 | HTTP-Transport + API-Key, Dockerfile, Compose, README, Smoke-Test | Abnahme v1 |

---

## 13. Offene Punkte und Ideen für später

**Klären beim Implementieren** (aus `itslearning-api.md`):
- Mapping von `LearningToolId` (Datei, Link, Seite, Test) → genaueres `kind` in `list_course_files`
- Abkürzung: `DownloadRedirect.ashx` direkt mit `LearningObjectId`/`LearningObjectInstanceId` aus der Ressourcen-API (spart etwa 6 Anfragen pro Datei)
- Anhänge an Aufgaben (`assignments/{id}/files/{fileId}/v1`): beim ersten echten Anhang verifizieren
- Tatsächliche Werte von `RoleInHierarchyTitle` → Default für `TEACHER_ROLE_TITLES` anpassen

**v2-Ideen:**
- Eltern-Konten (`children/{childId}/tasks|courses|plans|upcoming`)
- Kalender-Tool (Endpunkt verifiziert, an der Referenzinstanz leer)
- Wochenpläne (`planner/v1`, `children/{id}/plans/v1`)
- Optional: Login über fremde Anbieter mithilfe eines Headless-Browsers
