# itslearning REST API – findings for the MCP server

As of 2026-11-16 · Reference instance: a school on `https://<instance>.itslearning.com` (itslearning v2026.11)
Sources: the public API help pages at `/restapi/help` plus three probe runs with a **student account** (probe scripts; the current one is `scripts/dev/probe.ts`).

> This document deliberately contains no content, names or IDs from the account – only structures.
> Specification of the server built on top of it: [`mcp-server-spec.md`](./mcp-server-spec.md)

## TL;DR

| Use case | Feasible? | Main endpoint |
|---|---|---|
| Read tasks | ✅ | `GET /restapi/personal/tasks/v1` (+ `/assignments/{elementId}/v1` for details) |
| Read news | ✅ | `GET /restapi/personal/notifications/stream/v2?showLightBulletins=true` |
| Course announcements (bulletins) | ✅ | `GET /restapi/personal/courses/{courseId}/bulletins/v1` |
| Read messages | ✅ | `GET /restapi/personal/instantmessages/messagethreads/v4` |
| List course resources | ✅ | `GET /restapi/personal/courses/{courseId}/resources/v1` |
| Download files | ✅ | Message attachments/images: tokenized `filerepository` URL directly; course files: SSO URL → web session → `DownloadRedirect.ashx` (verified with a PDF) |
| Calendar | ⚠️ empty | API and iCal feed return 0 events – the reference instance does not use the calendar (tool implemented, unverified with data) |
| Weekly plans (planner) | ⏳ | `GET /restapi/personal/planner/v1?courseId=…` (tool implemented; at the reference instance a student account gets `403 "User does not have access to plans in course …"` – reported as `unavailableCourses`) |
| Parent accounts | ⏳ | `GET /restapi/personal/children/v1` + `children/{childId}/…` (experimental, no parent account tested) |

## General

- **API docs:** `https://<instance>.itslearning.com/restapi/help` (public ASP.NET Web API help page, ~220 GET endpoints). Not every documented endpoint is deployed (see "Not working").
- **Base URL:** instance host + `/restapi/personal/...`
- **Format:** JSON. Lists usually come as `{ EntityArray: [...], Total, CurrentPageIndex, PageSize }`, sometimes **nested one level** (`{ Resources: { EntityArray } }`, `{ Threads: { EntityArray }, HasMore }`).
- **Paging:** `PageIndex` (0-based) + `PageSize`. Parameter casing varies per endpoint (`pageSize` for messages v4).
- **Auth header:** `Authorization: Bearer <access_token>` works everywhere (the `?access_token=` fallback was never needed).
- **Errors:** 401 without/with an expired token, 403 with a plain-text message (contains IDs!), 404 as an HTML error page for unknown routes.

## Authentication

Login uses the OAuth2 Resource Owner Password Grant with the public client ID of the official mobile app:

```http
POST /restapi/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=10ae9d30-1853-48ff-81cb-47b58a325685&username=…&password=…
```

Refresh:

```http
grant_type=refresh_token&client_id=10ae9d30-1853-48ff-81cb-47b58a325685&refresh_token=…
```

Observed:

| Property | Value |
|---|---|
| `token_type` | `Bearer` |
| `expires_in` | **300 s** (also after refresh) |
| Refresh token | yes, **rotates on every refresh** |
| Wrong credentials | `401 {"ErrorCode":"InvalidUser"}` |
| Unknown instance | `401 {"ErrorCode":"Customer does not exist or is disabled"}` |
| Login page | native login only, no SSO (Microsoft/Google/…) → password grant works |

**Consequences for the server:**
- Refresh the access token proactively before it expires (~30 s margin).
- Because the refresh token rotates, the **new** refresh token must be persisted right after every refresh (otherwise the session is lost on restart). Store locally – never in the repository.
- Only use the password for the first login; afterwards refresh only.

## Endpoints by use case

### Person

`GET /restapi/personal/person/v1` → object with `PersonId`, `FirstName`, `LastName`, `FullName`, `ProfileImageUrl`, `Language`, `TimeZoneId`, `Children[]`, permission flags (`CanAccessMessageSystem`, `CanAccessCalendar`, `CanAccessCourses`, …) and **`iCalUrl` / `iCalFavoriteOnlyUrl`** (secret `webcal://` feed URLs containing `PersonId` + `Guid` → treat like a password).

`Children` is empty for a student account; `/restapi/personal/children/v1` returns 0 entries (see "Children (parent accounts)").

### Courses

| Endpoint | Result |
|---|---|
| `GET /courses/v1` | 33 courses |
| `GET /courses/v2`, `/v3`, `/v4` | 46 courses each, identical schema |
| `GET /courses/cards/starred/v1` | 25 (starred courses) |
| `GET /courses/{courseId}/v1` | `Code`, `CourseId`, `Title`, `CreatedDateTimeUtc`, `OrganisationId` |
| `GET /courses/{courseId}/features/v2` | the course's navigation tree (`Name`, `Url`, `Features[]`) |
| `GET /courses/{courseId}/participants/v1` | `PersonId`, `FullName`, `Role`, … – readable for a student account |

Course fields (list): `CourseId`, `Title`, `Url`, `LastUpdatedUtc`, `NewNotificationsCount`, `NewBulletinsCount`, `HasStudentPermissions`, `HasAdminPermissions`, `CourseColor`, `CourseCode`, `CourseFocus`.

**v1 vs. v2:** the 13 courses that only appear in v2 all have `HasStudentPermissions = false` (all v1 courses: `true`). Most likely former/archived courses or courses with a different role → **the server uses `v1`** (= current courses as a student), v2 optionally for "all courses".

### Tasks

`GET /restapi/personal/tasks/v1?PageSize=100` (optional `status`, `deadline`, `isHomework`) → 17 entries.

Fields: `TaskId`, `Title`, `Description`, `Status`, `Deadline`, `Homework`, `LocationTitle` (= course name), `LocationType`, `LocationId`, `ElementId`, `ElementType`, `LearningToolId`, `Url`, `ContentUrl`, `IconUrl`.

- Observed `Status` values: `NotStarted` (more are to be expected). The list also contains old, never-completed tasks from previous school years.
- Observed `ElementType` values: `LearningToolElement` (regular assignment), `CustomActivity`.
- **Details:** `GET /restapi/personal/assignments/{elementId}/v1` works for many `LearningToolElement` tasks. Returns e.g. `Text`/`RawText` (assignment text), `Deadline`, `IsHomework`, `IsMandatory`, `SubmissionType`, `CompletionMode`, `IsSubmissionAfterDeadlineAllowed`, `Files[]`, `FilesInCloud[]`, `TemplateFile`, `AnswerId`, `CanSubmitOrEditAnswer`, assessment info.
- For `CustomActivity` (and some other tools, e.g. polls/choices) the endpoint returns **403** – only the `ContentUrl` web page (via the web session) remains.
- Task attachments: `GET /assignments/{elementId}/files/{fileId}/v1` → according to the docs a **302 redirect** to the file. None of the tested tasks had attachments → still unverified.
- Course-specific: `GET /courses/{courseId}/tasks/v1`.
- Alternative view: `GET /tasklistdailyworkflow/v1` → grouped into sections (`SectionTitle`, containing `TaskDailyWorkflow.EntityArray` with `CourseTitle`, `TaskTitle`, `Deadline`, `DeadlineDisplayTime`, `IsHomework`). Handy for "what is due this week?".

### News

| Endpoint | Content |
|---|---|
| `GET /notifications/stream/v2?showLightBulletins=true&PageSize=…` | **main feed** (63 entries): course events incl. embedded light bulletins |
| `GET /notifications/newsfeed/v1` | similar feed (63), slimmer schema (`NewsFeedItemId`, `Text`, `LocationTitle`, `PublishedDate`, `PublishedBy`, `Url`) |
| `GET /notifications/v1`, `/v2` | only 1 entry (system notifications) – barely relevant |
| `GET /notifications/{notificationId}/elements/v1` | elements of a notification (empty in the sample) |
| `GET /courses/{courseId}/stream/v1?showLightBulletins=true` | stream of a single course |

Stream entry: `NotificationId`, `Text`, `LocationTitle`, `PublishedDate`, `PublishedBy{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl…}`, `Url`, `ContentUrl`, `ElementId`, `ElementType` (`Unknown`, `LearningToolElement`), `ElementsCount`, `LightBulletin{…}`, `LocationType`, `LocationId`.

### Course announcements (bulletins)

`GET /restapi/personal/courses/{courseId}/bulletins/v1?PageSize=…` (one course had 110 bulletins).

Fields: `LightBulletinId`, `Text`, `EmbedUrl`, `Pinned`, `PublishedDate`, `ActiveFromDate`, `ActiveToDate`, `PublishedBy{…}`, `AttachedImages[]{PreviewFileUrl, OriginalFileUrl, …}`, `HasResources`, `ResourcesCount`, `AllowComments`, `CommentsCount`.

- Attached resources: `GET /courses/bulletins/{bulletinId}/elements/v1` → list of `LearningToolElement`s (`ElementId`, `Title`, `Url`, `ContentUrl`).
- Images: `OriginalFileUrl` = `https://filerepository.itslearning.com/{guid}?Token=…` (tokenized, see "Downloading files").
- `GET /lightbulletins/v1` only exists as POST (405 on GET).

### Messages

`GET /restapi/personal/instantmessages/messagethreads/v4?pageSize=…` (optional `fromSortIndex` for paging) → `{ Threads: { EntityArray, Total }, HasMore }`. 113 threads; v1 ignores `pageSize` and returns at most 100. **`Total` is always 0** – use `HasMore`.

Thread: `InstantMessageThreadId`, `Name`, `Type` (`OneToOne`, `Group`, `Course`), `Created`, `CreatedBy`, `CreatedByTeacher`, `Participants[]{PersonId, FirstName, LastName, FullName, RoleInHierarchyTitle, ProfileUrl, ProfileImageUrl}`, `ParticipantsCount`, `LocationRecipients[]{Title, Type}`, `LastMessage{…}`, `Messages.EntityArray[]`, `LastReadInstantMessageId`, `SortIndex`.

Message: `MessageId`, `Created`, `CreatedBy`, `CreatedByName`, `CreatedByShortName`, `CreatedByAvatar`, `HomeOrganization`, `Text`, `AttachmentUrl`, `AttachmentName`, `Link`, `LinkTitle`, `IsSystemMessage`, `IsDeleted`, `IsEdited`, `IsBroadcastMassMessage`.

- More messages of a thread: `GET /messagethreads/{threadId}/messages/v3?pageSize=…&fromId=…` → `{ Messages: { EntityArray, Total } }`, same message schema (`Total` is 0 here as well). ✅
- `AttachmentUrl` = `https://filerepository.itslearning.com/{guid}?Token=…&Download=1` → direct download without auth ✅ (see "Downloading files").

### Course resources

`GET /restapi/personal/courses/{courseId}/resources/v1?PageSize=100` → `{ Resources: { EntityArray } }` (the course's root folder).

Resource: `ElementId`, `Title`, `ElementType` (`Folder`, `LearningToolElement`), `CourseId`, `Path`, `Url`, `ContentUrl`, `Active`, `Homework`, `LearningToolId`, `LearningObjectId`, `LearningObjectInstanceId`, `IsTopicOrPlanFolder`, `IconUrl`.

- Sub-folders: `GET /courses/{courseId}/folders/{folderId}/resources/v1` → same format. ✅ Walk all `Folder`s recursively for a full tree.
- Single resource incl. course: `GET /courses/resources/{resourceId}/v1` (additionally `CourseTitle`, `CourseCode`, `ContextRole`).
- `ContentUrl`: folder → `/Resources?FolderID=…`, element → `/LearningToolElement/ViewLearningToolElement.aspx?LearningToolElementId=…` (a web page, no direct download).
- In the sample all non-folders were `LearningToolElement`. Whether an element is a file, a link, a page or a test is not in `ElementType` but in `LearningToolId` or the `ExtensionId` inside `IconUrl`. That mapping is still open. Pragmatic approach: run the download flow and decide from the result (`content-disposition`) whether it is a file.

### Downloading files

Three paths, depending on the source:

**1. Tokenized filerepository URLs** ✅ (message attachments `AttachmentUrl`, bulletin images `OriginalFileUrl`/`PreviewFileUrl`, profile pictures)

```
GET https://filerepository.itslearning.com/{guid}?Token=…[&Download=1]
 → 302 → https://filecache.itslearning.com/…?…&expires=…&sign=…   (signed, expiring URL)
 → 200 file
```

No auth required, the token in the URL is enough. Tested: message attachment → `application/pdf`, `content-disposition: attachment`. Bulletin image → `image/jpeg`, `inline`. These URLs are therefore **secrets**: whoever has them can get the file.

**2. Course resources (LearningToolElement)** ✅ verified with a PDF (~1 MB)

The API provides no file URL, so the path goes through the web UI. A cookie jar is required; all hosts are under `*.itslearning.com`.

```
1. GET /restapi/personal/sso/url/v1?url=<ContentUrl>          (Bearer)
   → { Url: "https://<instance>.itslearning.com/{token}/MobileAppLoginSso.aspx?…&Signature=…" }
2. GET <Url>                         → 302 ProcessLogin.aspx?… → 302 ViewLearningToolElement.aspx (200, HTML)
3. The HTML contains <iframe src="https://platform.itslearning.com/LoginSSO.aspx?…">
   GET iframe src                    → 302 platform…/LearningObjects/LearningObjectInstance.aspx?…
                                     → 302 → 200 https://resource.itslearning.com/File/View.aspx?… (HTML)
4. The HTML contains the link https://resource.itslearning.com/Proxy/DownloadRedirect.ashx?LearningObjectId={n}&LearningObjectInstanceId={n}
   GET DownloadRedirect              → 302 filerepository…/{guid}?Token=…&Download=1
                                     → 302 filecache… → 200 file (content-disposition: attachment)
```

Observations:
- The resources API has the fields `LearningObjectId` and `LearningObjectInstanceId`, but at the reference instance they are **always `0`** – in the folder listings and in the element detail (checked for 107 file elements). Calling `DownloadRedirect.ashx` directly with the ids from the API is therefore not possible; the ids only exist in the `DownloadRedirect` link on the `File/View` page. ✅
- The session URLs (`MobileAppLoginSso`, `ProcessLogin`, `platform…/LoginSSO.aspx`, `File/View.aspx`) carry signatures as well as **`FirstName`, `LastName`, `Email`, `UserName`, `PersonId` as query parameters**. They must never be logged or handed to agents.
- About 8 requests per file → reuse the session and cache downloads locally.
- Pages that are not files (links, notes, embedded tools) can contain launch parameters of external learning tools as **URL-encoded JSON including `PersonId`** – these must be stripped from page text.

**3. Task attachments:** `GET /assignments/{elementId}/files/{fileId}/v1` → according to the docs a 302 to the file, presumably again `filerepository` → `filecache`. ⏳ (none of the tested tasks had attachments.)

### Calendar

- `GET /calendar/events/v1` **requires `fromDate`** (400 otherwise). With `fromDate` = today −7 days: 0 entries.
- `GET /courses/{courseId}/calendarevents/v1?fromDate=…`: 0 entries in 3 courses.
- iCal feed (`iCalUrl`, replace `webcal://` with `https://`): 200, valid `VCALENDAR`, but 0 `VEVENT`. The server wrongly serves it as `text/html`.
- → The reference instance does not use the itslearning calendar; deadlines come via tasks.
- **Implemented** as `itslearning_list_calendar` from the help-page models, ⏳ unverified with real events:
  - `calendar/events/v1?fromDate=YYYY-MM-DD&PageIndex=…&PageSize=…` (`CalendarEventV2`): `EventId`, `FromDate`, `ToDate`, `EventTitle`, `Description`, `ImportDescription`, `EventType` (`Course`, `Project`, `Personal`, `Hierarchy`), `LocationId`, `LocationTitle`. No `toDate` parameter → the period end is filtered client-side.
  - `courses/{courseId}/calendarevents/v1?fromDate=…&toDate=…` (`CalendarEvent`): `Id`, `FromDate`, `ToDate`, `EventTitle`, `Description`, `ImportDescription`, `CourseId`, `LocationTitle`.
  - Neither model contains person objects; free texts are redacted with the course dictionaries. `iCalUrl` is never used.

### Planner (weekly/lesson plans)

⏳ Implemented as `itslearning_list_plans` from the help-page models; the reference instance returned no plans.

- `GET /planner/v1?courseId=…&startDate=…&stopDate=…` (`PlanPreview`) → `{ EntityArray }` with `PlanId`, `TopicId`, `Order`, `LocationId`, `LocationType` (`Course`, `Project`), `LocationTitle`, `PlanName`, `PlanDescription`, `Start`, `Stop` (null if not set), `ClassHours`.
  - **`courseId` is required** – there is no cross-course listing; the server loops over the current courses.
  - **Dates need a time part** (`YYYY-MM-DDTHH:MM:SS`, sent as UTC midnight); returns plans that start or end within the period.
- `GET /planner/plansinfo/v1?plansIds[0]=…&plansIds[1]=…` (`PlanWithObjectivesAndElements`, array, indexed query parameters) → `PlanId`, `CourseId`, `CourseName`, `PlanTopicName`, `PlanTitle`, `PlanDescription`, `PlanStartDateTime`, `PlanEndDateTime`, `LearningObjectives[]{Id, Title, Description}`, `Elements[]{Id, Title, Type, IsMarkedAsHomework}`. `CoursePlannerUrl` and `IconUri` are not used. `Elements[].Id` is an element id (downloadable via `e_` fileRef).
- `children/{childId}/plans/v1` exists for parent accounts but is not used.

### Children (parent accounts)

⏳ **Experimental**, built from the help pages; not verified against a real parent account. A student account has no `Children` in `person/v1`, so the server never calls these endpoints for students.

| Endpoint | Fields used |
|---|---|
| `GET /children/v1` (`ChildV2`) | `PersonId`, `FirstName`, `LastName`, `FullName` (`School` is never emitted). `person/v1` → `Children[]` (deprecated) is the fallback. |
| `GET /children/{childId}/courses/v1` (`ChildCourse`) | `CourseId`, `Title`, `CourseCode`, `Teachers[]{PersonId, FirstName, LastName, FullName}` – no counters, favorites or former courses |
| `GET /children/{childId}/tasks/v1` | task schema as `tasks/v1`; per the help page only tasks that are not completed and not hidden |
| `GET /children/{childId}/courses/{courseId}/tasks/v1` | tasks of one course of the child |

Children are registered with the role `child` and teachers from `Teachers[]` as teachers before any text is redacted. Unknown: whether course participants and `assignments/{id}/v1` are readable for parents. `children/{childId}/plans/v1` and `…/upcoming/v1` are not used.

## Not working / not deployed

| Endpoint | Status | Note |
|---|---|---|
| `/organisations/v1`, `/hierarchies/v1` | 404 | do not exist |
| `/lightbulletins/v1` | 405 | POST only |
| `/courses/{id}/resources/lastupdated/v1` | 404 | documented, but not deployed |
| `/notifications/unread-count/v1` | 404 | documented, but not deployed |
| `/instantmessages/messagethreads/unread-count/v1` | 404 | documented, but not deployed |
| `/calendar/events/v1` without `fromDate` | 400 | parameter required |
| `/assignments/{id}/v1` for `CustomActivity` | 403 | web page only |

## Personal data & redaction

### Where personal data appears

**Structured person fields** (clearly identifiable):

| Endpoint | Fields |
|---|---|
| Person | `FirstName`, `LastName`, `FullName`, `PersonId`, `ProfileImageUrl`, `iCalUrl` (secret!) |
| Stream, newsfeed, bulletins | `PublishedBy.{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl, ProfileImageUrlSmall}` |
| Message threads | `Participants[].{PersonId, FirstName, LastName, FullName, ProfileUrl, ProfileImageUrl, RoleInHierarchyTitle}`, `CreatedBy` |
| Messages | `CreatedBy`, `CreatedByName`, `CreatedByShortName`, `CreatedByAvatar`, `HomeOrganization`, `DeletedBy` |
| Course participants | `PersonId`, `FullName` (format "Last, First" or "First Last"), `Role` |
| Assignment details | `ProgressReportUrl…PlaceHolder` contains `PersonId` |
| Course features | URLs containing `PersonId` |

**Free text that may contain names:** `Text` (stream, bulletins, messages, tasks), `Description`, `RawText`, `Title`/`Name` (thread names are often person names!), `AttachmentName`, `LinkTitle`, `LocationRecipients[].Title`, file names and file contents.

**Secrets** (never hand to agents, never log): access/refresh token, `iCalUrl`, SSO URLs and every session URL of the download flow (they additionally carry name, e-mail and user name as query parameters), filerepository URLs with `?Token=`, signed `filecache` URLs.

### Strategy (implemented, see the spec)

1. **Allowlist instead of blocklist:** every tool returns its own slim DTO, never the raw response. New API fields therefore never reach the agent automatically.
2. **Pseudonymisation of people:** people become stable pseudonyms (HMAC over `PersonId` with a local secret), the role comes from `CreatedByTeacher` / `RoleInHierarchyTitle` / course role. An agent can tell "same person" without knowing the name. The own account becomes `Me`.
3. **Name dictionary for free text:** all names from structured fields are collected and used to replace names in all free text (word-boundary based, case-insensitive). Plus regexes for e-mail addresses, phone numbers, internal links, ID pairs and URL-encoded blobs.
4. **URLs:** profile/avatar URLs are dropped; itslearning element URLs are replaced by internal references (the agent fetches details/downloads via tools); filerepository tokens are never emitted.
5. **Files:** extracted text (PDF/DOCX/text) goes through the same redaction. **Limit:** names in images/scans, and unknown names (never seen in a structured field), are not detected.
6. **Configurable:** e.g. `REDACT_TEACHERS=true` to pseudonymise teachers as well.

> GDPR note: pseudonymisation is not anonymisation. Redaction reduces the risk considerably but does not replace the decision which data should go to a (cloud) LLM at all.

## Status of the checks

- [x] Course resource download via SSO URL + web session (PDF)
- [x] Direct download of tokenized filerepository URLs (message attachment PDF, bulletin image JPEG)
- [x] Sub-folder resources
- [x] `messagethreads/{id}/messages/v3`
- [x] iCal feed (empty)
- [x] Course participants readable for a student account
- [ ] Task attachments (`/assignments/{id}/files/{fileId}/v1`): no test data available yet
- [ ] `LearningToolId` mapping (file vs. link vs. page vs. test)
- [ ] Calendar and planner with real data (tools implemented)
- [ ] Parent account (`children/…`, experimental support implemented)

## Probe scripts

| Script | Purpose |
|---|---|
| `scripts/lib.ts` | Terminal input (hidden password), OAuth2 login, refresh, API client with auto-refresh |
| `scripts/dev/probe.ts` (`bun run probe`) | Deep probe; writes a **redacted** report to `probe-output/report.json` (field names/types, status, counts, URL patterns, enum values only). `--save` additionally stores raw data locally (private!). |

`probe-output/` is gitignored.
