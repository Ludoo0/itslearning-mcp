# itslearning REST-API – Erkenntnisse für den MCP-Server

Stand: 2026-11-16 · Referenzinstanz: eine Schule auf `https://<schule>.itslearning.com` (itslearning v2026.11)
Quelle: öffentliche API-Doku unter `/restapi/help` + drei Probe-Läufe mit einem **Schülerkonto** (`scripts/probe.ts`, `scripts/probe2.ts`).

> Diese Doku enthält bewusst keine Inhalte, Namen oder IDs aus dem Konto – nur Strukturen.
> Spezifikation des darauf aufbauenden Servers: [`mcp-server-spec.md`](./mcp-server-spec.md)

## TL;DR

| Use Case | Machbar? | Wichtigster Endpunkt |
|---|---|---|
| Aufgaben lesen | ✅ | `GET /restapi/personal/tasks/v1` (+ `/assignments/{elementId}/v1` für Details) |
| Neuigkeiten lesen | ✅ | `GET /restapi/personal/notifications/stream/v2?showLightBulletins=true` |
| Kurs-News (Bulletins) | ✅ | `GET /restapi/personal/courses/{courseId}/bulletins/v1` |
| Nachrichten lesen | ✅ | `GET /restapi/personal/instantmessages/messagethreads/v4` |
| Kurs-Ressourcen listen | ✅ | `GET /restapi/personal/courses/{courseId}/resources/v1` |
| Dateien herunterladen | ✅ | Nachrichten-Anhänge/Bilder: tokenisierte `filerepository`-URL direkt; Kurs-Dateien: SSO-URL → Web-Session → `DownloadRedirect.ashx` (verifiziert mit PDF) |
| Kalender | ⚠️ leer | API und iCal-Feed liefern 0 Termine – Schule nutzt den Kalender nicht |

## Allgemeines

- **API-Doku:** `https://<schule>.itslearning.com/restapi/help` (öffentlich, ASP.NET Web API Help Page, ~220 GET-Endpunkte). Nicht alle dokumentierten Endpunkte sind deployt (siehe „Funktioniert nicht“).
- **Base-URL:** Instanz-Host + `/restapi/personal/...`
- **Format:** JSON. Listen kommen meist als `{ EntityArray: [...], Total, CurrentPageIndex, PageSize }`, teils **eine Ebene verschachtelt** (`{ Resources: { EntityArray } }`, `{ Threads: { EntityArray }, HasMore }`).
- **Paging:** `PageIndex` (0-basiert) + `PageSize`. Groß-/Kleinschreibung der Parameter variiert je Endpunkt (`pageSize` bei Messages v4).
- **Auth-Header:** `Authorization: Bearer <access_token>` funktioniert überall (Fallback `?access_token=` war nie nötig).
- **Fehler:** 401 ohne/mit abgelaufenem Token, 403 mit Klartext-Meldung (enthält IDs!), 404 als HTML-Fehlerseite bei unbekannten Routen.

## Authentifizierung

Login über OAuth2 Resource Owner Password Grant mit der öffentlichen Client-ID der offiziellen Mobile-App:

```http
POST /restapi/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=10ae9d30-1853-48ff-81cb-47b58a325685&username=…&password=…
```

Refresh:

```http
grant_type=refresh_token&client_id=10ae9d30-1853-48ff-81cb-47b58a325685&refresh_token=…
```

Beobachtet:

| Eigenschaft | Wert |
|---|---|
| `token_type` | `Bearer` |
| `expires_in` | **300 s** (auch nach Refresh) |
| Refresh-Token | ja, **rotiert bei jedem Refresh** |
| Falsche Zugangsdaten | `401 {"ErrorCode":"InvalidUser"}` |
| Login-Seite | nur nativer Login, kein SSO (Microsoft/Google/IServ) → Password Grant funktioniert |

**Konsequenzen für den Server:**
- Access-Token proaktiv vor Ablauf (~30 s Puffer) erneuern.
- Weil der Refresh-Token rotiert, muss der **neue** Refresh-Token nach jedem Refresh sofort persistiert werden (sonst ist die Session nach einem Neustart weg). Speicherung lokal, z. B. Windows Credential Manager / verschlüsselte Datei – nie im Repo.
- Passwort nur beim Erst-Login abfragen, danach nur noch Refresh.

## Endpunkte nach Use Case

### Person

`GET /restapi/personal/person/v1` → Objekt mit `PersonId`, `FirstName`, `LastName`, `FullName`, `ProfileImageUrl`, `Language`, `TimeZoneId`, `Children[]`, Berechtigungs-Flags (`CanAccessMessageSystem`, `CanAccessCalendar`, `CanAccessCourses`, …) sowie **`iCalUrl` / `iCalFavoriteOnlyUrl`** (geheime `webcal://`-Feed-URLs mit `PersonId` + `Guid` → wie ein Passwort behandeln).

`Children` ist beim Schülerkonto leer; `/restapi/personal/children/v1` liefert 0 Einträge.

### Kurse

| Endpunkt | Ergebnis |
|---|---|
| `GET /courses/v1` | 33 Kurse |
| `GET /courses/v2`, `/v3`, `/v4` | je 46 Kurse, identisches Schema |
| `GET /courses/cards/starred/v1` | 25 (favorisierte Kurse) |
| `GET /courses/{courseId}/v1` | `Code`, `CourseId`, `Title`, `CreatedDateTimeUtc`, `OrganisationId` |
| `GET /courses/{courseId}/features/v2` | Navigationsbaum des Kurses (`Name`, `Url`, `Features[]`) |

Kurs-Felder (Liste): `CourseId`, `Title`, `Url`, `LastUpdatedUtc`, `NewNotificationsCount`, `NewBulletinsCount`, `HasStudentPermissions`, `HasAdminPermissions`, `CourseColor`, `CourseCode`, `CourseFocus`.

**v1 vs. v2:** Die 13 Kurse, die nur in v2 auftauchen, haben alle `HasStudentPermissions = false` (alle v1-Kurse: `true`). Vermutlich ehemalige/archivierte Kurse oder Kurse mit anderer Rolle → **für den MCP `v1` nutzen** (= aktuelle Kurse als Schüler), v2 optional für „alle Kurse“.

### Aufgaben

`GET /restapi/personal/tasks/v1?PageSize=100` (optional `status`, `deadline`, `isHomework`) → 17 Einträge.

Felder: `TaskId`, `Title`, `Description`, `Status`, `Deadline`, `Homework`, `LocationTitle` (= Kursname), `LocationType`, `LocationId`, `ElementId`, `ElementType`, `LearningToolId`, `Url`, `ContentUrl`, `IconUrl`.

- Gesehene `Status`-Werte: `NotStarted` (weitere zu erwarten).
- Gesehene `ElementType`-Werte: `LearningToolElement` (normale Aufgabe), `CustomActivity`.
- **Details:** `GET /restapi/personal/assignments/{elementId}/v1` funktioniert für `LearningToolElement`-Aufgaben. Liefert u. a. `Text`/`RawText` (Aufgabenstellung), `Deadline`, `IsHomework`, `IsMandatory`, `SubmissionType`, `CompletionMode`, `IsSubmissionAfterDeadlineAllowed`, `Files[]`, `FilesInCloud[]`, `TemplateFile`, `AnswerId`, `CanSubmitOrEditAnswer`, Bewertungsinfos.
- Für `CustomActivity` liefert der Endpunkt **403** – hier bleibt nur `ContentUrl` (`/CustomActivity/CustomActivityOverview.aspx?CustomActivityId=…`) über die Web-Session.
- Anhänge einer Aufgabe: `GET /assignments/{elementId}/files/{fileId}/v1` → laut Doku **302-Redirect** zur Datei. In den getesteten Aufgaben waren keine Dateien angehängt → noch unverifiziert.
- Kurs-spezifisch: `GET /courses/{courseId}/tasks/v1`.
- Alternative Ansicht: `GET /tasklistdailyworkflow/v1` → nach Abschnitten gruppiert (`SectionTitle`, darin `TaskDailyWorkflow.EntityArray` mit `CourseTitle`, `TaskTitle`, `Deadline`, `DeadlineDisplayTime`, `IsHomework`). Praktisch für „Was ist diese Woche fällig?“.

### Neuigkeiten

| Endpunkt | Inhalt |
|---|---|
| `GET /notifications/stream/v2?showLightBulletins=true&PageSize=…` | **Hauptfeed** (63 Einträge): Kurs-Ereignisse inkl. eingebetteter Light Bulletins |
| `GET /notifications/newsfeed/v1` | ähnlicher Feed (63), schlankeres Schema (`NewsFeedItemId`, `Text`, `LocationTitle`, `PublishedDate`, `PublishedBy`, `Url`) |
| `GET /notifications/v1`, `/v2` | nur 1 Eintrag (System-Benachrichtigungen) – kaum relevant |
| `GET /notifications/{notificationId}/elements/v1` | Elemente einer Benachrichtigung (in der Stichprobe leer) |
| `GET /courses/{courseId}/stream/v1?showLightBulletins=true` | Stream eines einzelnen Kurses |

Stream-Eintrag: `NotificationId`, `Text`, `LocationTitle`, `PublishedDate`, `PublishedBy{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl…}`, `Url`, `ContentUrl`, `ElementId`, `ElementType` (`Unknown`, `LearningToolElement`), `ElementsCount`, `LightBulletin{…}`, `LocationType`, `LocationId`.

### Kurs-News (Bulletins)

`GET /restapi/personal/courses/{courseId}/bulletins/v1?PageSize=…` (ein Kurs hatte 110 Bulletins).

Felder: `LightBulletinId`, `Text`, `EmbedUrl`, `Pinned`, `PublishedDate`, `ActiveFromDate`, `ActiveToDate`, `PublishedBy{…}`, `AttachedImages[]{PreviewFileUrl, OriginalFileUrl, …}`, `HasResources`, `ResourcesCount`, `AllowComments`, `CommentsCount`.

- Angehängte Ressourcen: `GET /courses/bulletins/{bulletinId}/elements/v1` → Liste von `LearningToolElement`s (`ElementId`, `Title`, `Url`, `ContentUrl`).
- Bilder: `OriginalFileUrl` = `https://filerepository.itslearning.com/{guid}?Token=…` (tokenisiert, s. Dateien).
- `GET /lightbulletins/v1` existiert nur als POST (405 bei GET).

### Nachrichten

`GET /restapi/personal/instantmessages/messagethreads/v4?pageSize=…` (optional `fromSortIndex` fürs Paging) → `{ Threads: { EntityArray, Total }, HasMore }`. 113 Threads; v1 ignoriert `pageSize` und liefert max. 100.

Thread: `InstantMessageThreadId`, `Name`, `Type` (`OneToOne`, `Group`, `Course`), `Created`, `CreatedBy`, `CreatedByTeacher`, `Participants[]{PersonId, FirstName, LastName, FullName, RoleInHierarchyTitle, ProfileUrl, ProfileImageUrl}`, `ParticipantsCount`, `LocationRecipients[]{Title, Type}`, `LastMessage{…}`, `Messages.EntityArray[]`, `LastReadInstantMessageId`, `SortIndex`.

Nachricht: `MessageId`, `Created`, `CreatedBy`, `CreatedByName`, `CreatedByShortName`, `CreatedByAvatar`, `HomeOrganization`, `Text`, `AttachmentUrl`, `AttachmentName`, `Link`, `LinkTitle`, `IsSystemMessage`, `IsDeleted`, `IsEdited`, `IsBroadcastMassMessage`.

- Mehr Nachrichten eines Threads: `GET /messagethreads/{threadId}/messages/v3?pageSize=…&fromId=…` → `{ Messages: { EntityArray } }`, gleiches Nachrichten-Schema. ✅
- `AttachmentUrl` = `https://filerepository.itslearning.com/{guid}?Token=…&Download=1` → direkter Download ohne Auth ✅ (s. Dateien).

### Kurs-Ressourcen

`GET /restapi/personal/courses/{courseId}/resources/v1?PageSize=100` → `{ Resources: { EntityArray } }` (Root-Ordner des Kurses).

Ressource: `ElementId`, `Title`, `ElementType` (`Folder`, `LearningToolElement`), `CourseId`, `Path`, `Url`, `ContentUrl`, `Active`, `Homework`, `LearningToolId`, `LearningObjectId`, `LearningObjectInstanceId`, `IsTopicOrPlanFolder`, `IconUrl`.

- Unterordner: `GET /courses/{courseId}/folders/{folderId}/resources/v1` → gleiches Format. ✅ Für einen vollständigen Baum rekursiv über alle `Folder` gehen.
- Einzelne Ressource inkl. Kurs: `GET /courses/resources/{resourceId}/v1` (zusätzlich `CourseTitle`, `CourseCode`, `ContextRole`).
- `ContentUrl`: Ordner → `/Resources?FolderID=…`, Element → `/LearningToolElement/ViewLearningToolElement.aspx?LearningToolElementId=…` (Web-Seite, kein direkter Download).
- In der Stichprobe (13 Elemente aus 3 Kursen) waren alle Nicht-Ordner `LearningToolElement`. Ob ein Element eine Datei, ein Link, eine Seite oder ein Test ist, steckt nicht im `ElementType`, sondern in `LearningToolId` bzw. `ExtensionId` im `IconUrl`. Das Mapping ist noch offen. Pragmatisch: Download-Flow versuchen und am Ergebnis (`content-disposition`) erkennen, ob es eine Datei ist.

### Dateien herunterladen

Drei Wege, je nach Quelle:

**1. Tokenisierte filerepository-URLs** ✅ (Nachrichten-Anhänge `AttachmentUrl`, Bulletin-Bilder `OriginalFileUrl`/`PreviewFileUrl`, Profilbilder)

```
GET https://filerepository.itslearning.com/{guid}?Token=…[&Download=1]
 → 302 → https://filecache.itslearning.com/…?…&expires=…&sign=…   (signierte, ablaufende URL)
 → 200 Datei
```

Keine Auth nötig, das Token in der URL reicht. Getestet: Nachrichten-Anhang → `application/pdf`, `content-disposition: attachment`. Bulletin-Bild → `image/jpeg`, `inline`. Diese URLs sind damit **Geheimnisse**: Wer sie hat, kommt an die Datei.

**2. Kurs-Ressourcen (LearningToolElement)** ✅ verifiziert mit einem PDF (~1 MB)

Die API liefert keine Datei-URL, also geht es über die Web-Oberfläche. Ein Cookie-Jar ist nötig; alle Hosts liegen unter `*.itslearning.com`.

```
1. GET /restapi/personal/sso/url/v1?url=<ContentUrl>          (Bearer)
   → { Url: "https://<schule>.itslearning.com/{token}/MobileAppLoginSso.aspx?…&Signature=…" }
2. GET <Url>                         → 302 ProcessLogin.aspx?… → 302 ViewLearningToolElement.aspx (200, HTML)
3. HTML enthält <iframe src="https://platform.itslearning.com/LoginSSO.aspx?…">
   GET iframe-src                    → 302 platform…/LearningObjects/LearningObjectInstance.aspx?…
                                     → 302 → 200 https://resource.itslearning.com/File/View.aspx?… (HTML)
4. HTML enthält Link https://resource.itslearning.com/Proxy/DownloadRedirect.ashx?LearningObjectId={n}&LearningObjectInstanceId={n}
   GET DownloadRedirect              → 302 filerepository…/{guid}?Token=…&Download=1
                                     → 302 filecache… → 200 Datei (content-disposition: attachment)
```

Beobachtungen:
- `LearningObjectId` und `LearningObjectInstanceId` aus dem `DownloadRedirect`-Link stehen **auch in der Ressourcen-API**. Möglicher Abkürzungsweg: Nach einmaligem Aufbau der `resource.itslearning.com`-Session direkt `DownloadRedirect.ashx` mit den IDs aus der API aufrufen. ⏳ (noch nicht getestet)
- Die Session-URLs (`MobileAppLoginSso`, `ProcessLogin`, `platform…/LoginSSO.aspx`, `File/View.aspx`) tragen Signaturen sowie **`FirstName`, `LastName`, `Email`, `UserName`, `PersonId` als Query-Parameter**. Sie dürfen nie geloggt oder an Agenten weitergegeben werden.
- Etwa 8 Requests pro Datei → Session pro Lauf wiederverwenden und Downloads lokal cachen (Schlüssel: `ElementId` + `LastUpdated`).

**3. Aufgaben-Anhänge:** `GET /assignments/{elementId}/files/{fileId}/v1` → laut Doku 302 auf die Datei, vermutlich wieder `filerepository` → `filecache`. ⏳ (In den getesteten Aufgaben waren keine Dateien angehängt.)

### Kalender

- `GET /calendar/events/v1` **braucht `fromDate`** (sonst 400). Mit `fromDate` = heute −7 Tage: 0 Einträge.
- `GET /courses/{courseId}/calendarevents/v1?fromDate=…`: in 3 Kursen 0 Einträge.
- iCal-Feed (`iCalUrl`, `webcal://` durch `https://` ersetzen): 200, gültiges `VCALENDAR`, aber 0 `VEVENT`. Der Server liefert ihn fälschlich als `text/html`.
- → Die Schule nutzt den itslearning-Kalender nicht. Für den MCP vorerst weglassen; Fristen kommen über Aufgaben.

## Funktioniert nicht / nicht deployt

| Endpunkt | Status | Anmerkung |
|---|---|---|
| `/organisations/v1`, `/hierarchies/v1` | 404 | existieren nicht |
| `/lightbulletins/v1` | 405 | nur POST |
| `/courses/{id}/resources/lastupdated/v1` | 404 | in Doku, aber nicht deployt |
| `/notifications/unread-count/v1` | 404 | in Doku, aber nicht deployt |
| `/instantmessages/messagethreads/unread-count/v1` | 404 | in Doku, aber nicht deployt |
| `/calendar/events/v1` ohne `fromDate` | 400 | Parameter Pflicht |
| `/assignments/{id}/v1` für `CustomActivity` | 403 | nur über Web-Seite |

## Personenbezogene Daten & Redaction

### Wo personenbezogene Daten vorkommen

**Strukturierte Personenfelder** (eindeutig erkennbar):

| Endpunkt | Felder |
|---|---|
| Person | `FirstName`, `LastName`, `FullName`, `PersonId`, `ProfileImageUrl`, `iCalUrl` (Geheimnis!) |
| Stream, Newsfeed, Bulletins | `PublishedBy.{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl, ProfileImageUrlSmall}` |
| Nachrichten-Threads | `Participants[].{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl, RoleInHierarchyTitle}`, `CreatedBy` |
| Nachrichten | `CreatedBy`, `CreatedByName`, `CreatedByShortName`, `CreatedByAvatar`, `HomeOrganization`, `DeletedBy` |
| Assignment-Detail | `ProgressReportUrl…PlaceHolder` enthält `PersonId` |
| Kurs-Features | URLs mit `PersonId` |

**Freitext, in dem Namen stehen können:** `Text` (Stream, Bulletins, Nachrichten, Aufgaben), `Description`, `RawText`, `Title`/`Name` (Thread-Namen sind oft Personennamen!), `AttachmentName`, `LinkTitle`, `LocationRecipients[].Title`, Dateinamen und Dateiinhalte.

**Geheimnisse** (nie an Agenten geben, nie loggen): Access-/Refresh-Token, `iCalUrl`, SSO-URLs und alle Session-URLs aus dem Download-Flow (die enthalten zusätzlich Name, E-Mail und Benutzername als Query-Parameter), filerepository-URLs mit `?Token=`, signierte `filecache`-URLs.

### Vorgeschlagene Strategie für den MCP-Server

1. **Allowlist statt Blocklist:** Jedes Tool gibt ein eigenes, schlankes DTO zurück (z. B. `{ title, course, deadline, status, text }`), nie die Roh-Antwort. Neue Felder der API landen so nicht automatisch beim Agenten.
2. **Pseudonymisierung von Personen:** Personen werden zu stabilen Pseudonymen, z. B. `Lehrkraft-A3F2` / `Schüler:in-91BC` (HMAC über `PersonId` mit lokalem Secret). Die Rolle kommt aus `CreatedByTeacher` / `RoleInHierarchyTitle`. So erkennt ein Agent „gleiche Person“, ohne den Namen zu kennen. Das eigene Konto wird zu `Ich`.
3. **Namens-Wörterbuch für Freitext:** Alle Namen, die in Strukturfeldern auftauchen (`PublishedBy`, `Participants`, `CreatedByName` …), werden in einem lokalen Wörterbuch gesammelt (Vor-, Nach-, Kurzname). Daraus werden Ersetzungen für alle Freitexte gebaut (wortgrenzen-basiert, Groß-/Kleinschreibung ignoriert). Zusätzlich Regex für E-Mail-Adressen, Telefonnummern und itslearning-Profil-URLs.
4. **URLs:** Profil-/Avatar-URLs entfernen; itslearning-Element-URLs durch interne IDs ersetzen (Agent ruft Details/Download über Tools ab); filerepository-Tokens nie ausgeben.
5. **Dateien:** Download landet lokal in einem Arbeitsverzeichnis; der Agent bekommt Pfad, Typ und Größe mit geschwärztem Dateinamen. Optional Textextraktion (PDF/DOCX) mit derselben Freitext-Redaction. **Grenze:** Namen in Bildern/Scans oder unbekannte Namen (die nie in einem Strukturfeld vorkamen) werden nicht erkannt.
6. **Konfigurierbar:** z. B. `ITSL_REDACT_TEACHERS=false`, falls Lehrkräfte-Namen für die Agenten nützlich und vertretbar sind. Default: alles redacted.

> Hinweis DSGVO: Pseudonymisierung ≠ Anonymisierung. Die Redaction reduziert das Risiko deutlich, ersetzt aber nicht die Abwägung, welche Daten überhaupt an ein (Cloud-)LLM gehen.

## Status der Prüfpunkte

- [x] Datei-Download Kurs-Ressourcen über SSO-URL + Web-Session (PDF)
- [x] Direkter Download tokenisierter filerepository-URLs (Nachrichten-Anhang PDF, Bulletin-Bild JPEG)
- [x] Unterordner-Ressourcen
- [x] `messagethreads/{id}/messages/v3`
- [x] iCal-Feed (leer)
- [ ] Aufgaben-Anhänge (`/assignments/{id}/files/{fileId}/v1`): keine Testdaten vorhanden. Beim ersten echten Anhang im MCP prüfen.
- [ ] `LearningToolId`-Mapping (Datei vs. Link vs. Seite vs. Test)
- [ ] Abkürzung `DownloadRedirect.ashx` direkt mit IDs aus der API
- [ ] Wie verhalten sich andere `LearningToolElement`-Typen (Link, Seite) im Download-Flow?

Keiner der offenen Punkte blockiert den Bau des MCP-Servers. Sie lassen sich beim Implementieren klären.

## Probe-Skripte

| Skript | Zweck |
|---|---|
| `scripts/lib.ts` | Terminal-Eingabe (verdecktes Passwort), OAuth2-Login, Refresh, API-Client mit Auto-Refresh |
| `scripts/probe.ts` (`bun run probe`) | Runde 1: grobe Verfügbarkeit von 12 Endpunkten |
| `scripts/probe2.ts` (`bun run probe2`) | Runde 2/3: Tiefenprobe; schreibt **redacted** Report nach `probe-output/report2.json` (nur Feldnamen/Typen, Status, Anzahlen, URL-Muster, Enum-Werte). `--save` speichert zusätzlich Rohdaten lokal (privat!). |

`probe-output/` ist in `.gitignore`.
