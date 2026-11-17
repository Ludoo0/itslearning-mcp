# itslearning MCP server – specification (v0.1)

As of 2026-11-17 · Status: implemented (v0.1.0)
Based on: [`itslearning-api.md`](./itslearning-api.md) (verified endpoints, ✅ = tested, ⏳ = still open) · Open items: [`roadmap.md`](./roadmap.md)

---

## 1. Goal and scope

An MCP server that gives AI agents **read-only** access to an itslearning account: tasks, news, course announcements, messages and files. **Personal data is redacted** before it leaves the server.

| In v0.1 | Not in v0.1 (non-goals) |
|---|---|
| Any itslearning instance (`ITSL_BASE_URL`) | Write actions (sending messages, submissions, comments) |
| Student accounts with native login (user name/password) | Instances that only offer login via a third-party identity provider (Microsoft/Google/Feide/…) |
| Tasks, news, bulletins, messages, course files, downloads | Calendar (unused at the reference instance; easy to add) |
| Docker container or local process (stdio) | Parent accounts (the API has `children/{childId}/…` endpoints – see roadmap) |
| One account per server process | Multiple accounts per process (run several containers instead) |

**Principles**

1. **Read-only.** The server only calls `GET` endpoints, plus `POST /restapi/oauth2/token` for login.
2. **Allowlist instead of pass-through.** Every tool returns its own slim DTO, never the raw API response.
3. **Privacy by default.** Unknown things are redacted; secrets (tokens, signed URLs) never leave the server.
4. **Gentle on the instance.** Caching, few parallel requests, no background polling without a tool call.

---

## 2. Architecture

```
┌──────────────┐  MCP (Streamable HTTP / stdio)  ┌──────────────────────────────────────────────┐
│ Agent/client │ ─────────────────────────────▶ │ server ─▶ tools ─▶ redaction ─▶ DTOs           │
└──────────────┘                                 │              │                                 │
                                                 │              ▼                                 │
                                                 │   api (REST, Bearer) ◀── auth (TokenStore)     │
                                                 │   websession (SSO → cookies → download)        │
                                                 │   files (refs, cache, text extraction)         │
                                                 └──────────────────────┬───────────────────────┘
                                                                        ▼
                                                     https://<instance>.itslearning.com
```

**Stack:** Bun ≥ 1.4, TypeScript (strict), `@modelcontextprotocol/sdk` (Streamable HTTP + stdio), `zod` (input schemas). Text extraction with `unpdf` (PDF) and `mammoth` (DOCX). No build step – the server runs `bun src/server.ts`.

**Modules (`src/`)**

| Module | Responsibility |
|---|---|
| `server.ts` | Entry point, transport selection (`stdio` / `http`), shutdown |
| `http.ts` | Stateless Streamable HTTP on `Bun.serve`, bearer API key, `/healthz`, origin check |
| `app.ts` | Wiring (`createApp`), server instructions, tool registration |
| `config.ts` | Environment variables + `*_FILE` secrets, validation (zod) |
| `context.ts` | `AppContext`, `ensureReady()` (login, own account, name-dictionary warm-up) |
| `auth/` | Token store (login, refresh, persistence, single-flight), login-mode detection |
| `api/` | REST client (limiter, TTL cache, retries, error mapping), typed endpoints |
| `websession/` | Minimal browser: manual redirects, cookie jar, size limit, link extraction |
| `files/` | fileRefs, download service, disk cache, text extraction |
| `redaction/` | Person registry, labels (en/de), teacher directory, name dictionary, secret/URL filters, HTML → text |
| `tools/` | One module per tool group: zod schema, handler, DTO mapping |
| `log.ts` | Structured logging to stderr with mandatory scrubbing |

---

## 3. Configuration

All values come from environment variables. Secrets also have a `*_FILE` variant (Docker secrets); if set, it takes precedence.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ITSL_BASE_URL` | ✅ | – | e.g. `https://yourschool.itslearning.com` (no path) |
| `ITSL_USERNAME` / `_FILE` | ✅ | – | itslearning user name |
| `ITSL_PASSWORD` / `_FILE` | ✅ | – | itslearning password |
| `ITSL_CLIENT_ID` | | `10ae9d30-1853-48ff-81cb-47b58a325685` | OAuth client ID (public ID of the official mobile app) |
| `MCP_TRANSPORT` | | `stdio` (Docker image: `http`) | `stdio` or `http` (Streamable HTTP) |
| `MCP_HOST` | | `127.0.0.1` (Docker image: `0.0.0.0`) | HTTP bind address |
| `MCP_PORT` | | `3000` | HTTP port |
| `MCP_API_KEY` / `_FILE` | ✅ with `http` | – | Bearer key clients must send (≥ 32 characters) |
| `MCP_ALLOWED_ORIGINS` | | empty | Allowed browser origins (comma-separated); requests with any other `Origin` header → 403 (DNS-rebinding protection) |
| `REDACTION_LANGUAGE` | | `en` | Language of labels and placeholders: `en` or `de` (see 6.2) |
| `REDACTION_SECRET` / `_FILE` | | auto | HMAC secret for pseudonyms (≥ 16 characters). If missing, one is generated once and stored in `DATA_DIR/secret` |
| `REDACTION_KEEP_WORDS` | | empty | Comma-separated words that are never replaced as a single name (see 6.4) |
| `REDACT_TEACHERS` | | `false` | `true` → pseudonymise teachers as well (`Teacher-XXXX`) |
| `TEACHER_ROLE_TITLES` | | `Teacher,Staff,Lehrer,Lehrerin,Lehrkraft,Mitarbeiter` | Role titles (`RoleInHierarchyTitle`, course `Role`) that count as teacher (substring match, case-insensitive) |
| `MAX_FILE_MB` | | `25` | Larger files are rejected |
| `CACHE_TTL_S` | | `60` | Lifetime of the list cache |
| `MAX_CONCURRENCY` | | `2` | Parallel requests to itslearning |
| `MIN_REQUEST_INTERVAL_MS` | | `200` | Minimum spacing between requests |
| `DATA_DIR` | | `/data` | Persistence (login state, secret, teacher directory, file cache) |
| `DOWNLOAD_DIR` | | – | Optional: additionally store downloaded files here (redacted file name) |
| `LOG_LEVEL` | | `info` | `debug` \| `info` \| `warn` \| `error` |

Invalid configuration → startup aborts with a clear error message that does not print secrets.

---

## 4. Authentication and session

### 4.1 Login and startup check

1. On startup the server reads `DATA_DIR/state.json` (if present) and tries a refresh.
2. If there is no state or the refresh fails: password login (`grant_type=password`).
3. **Compatibility check** on failure:
   - `401 InvalidUser` → "user name or password wrong" (**fatal**, see 4.2).
   - `Customer does not exist or is disabled` → "check ITSL_BASE_URL" (fatal).
   - Other failures → the server fetches the instance's login page; if it only offers federated login (`federatedLogin` without `nativeLogin`) it reports `SSO_NOT_SUPPORTED`.
4. Then `GET /person/v1` → the own `PersonId` (shown as "Me") and warm-up of the name dictionary with the participants of the 50 most recent message threads.
5. The server starts even if login fails; tools then return the error in a structured way.

### 4.2 Token lifecycle

- Access tokens are valid for 300 s → **proactive refresh 30 s before expiry**.
- **The refresh token rotates on every refresh.** The new token is persisted immediately and atomically (write temp file, rename) to `DATA_DIR/state.json` (mode `0600`): `{ baseUrl, username, refreshToken, updatedAt }`. State for a different `baseUrl`/`username` is ignored.
- **Single flight:** at most one refresh at a time; parallel requests wait for its result.
- Refresh fails (e.g. revoked) → one password login. If itslearning is down (5xx), the server does **not** fall back to the password.
- **Wrong password is fatal:** no further login attempts until restart – a container restart loop must not lock the account.
- `401` on an API request → one refresh + retry, then error.

### 4.3 Web session (course files only)

- Built on demand via `GET /restapi/personal/sso/url/v1?url=<ContentUrl>` (see `itslearning-api.md` → downloading files, path 2).
- One cookie jar per process, only sent to `*.itslearning.com`. If the result is a login page, the session is rebuilt once.

---

## 5. Tools

Conventions:
- Names are prefixed `itslearning_`. All tools are annotated `readOnlyHint: true`.
- IDs (course, task, thread, element) are numeric itslearning IDs, needed for follow-up calls. **`PersonId` is never emitted.**
- **Files** are referenced only via `fileRef` (5.10).
- Every result is returned as `structuredContent` **and** as text (summary + JSON). Everything an agent needs is in `structuredContent` – some clients (e.g. Claude Code) only show that part.
- Errors: `isError: true` with a code (section 9).

Common types:

```ts
type Person = { display: string; role: "self" | "teacher" | "student" | "unknown" };
type FileRefDto = { fileRef: string; name: string; kind: "file" | "image" | "unknown" };
```

| # | Tool | Input | Output (main fields) | Endpoints |
|---|---|---|---|---|
| 5.1 | `itslearning_overview` | `days` (7), `newsSince?`, `overdueMaxAgeDays` (60) | `overdue[]`, `dueSoon[]`, `news[]`, `unreadThreads`, `unreadThreadsPreview[]` | tasks, stream, threads |
| 5.2 | `itslearning_list_courses` | `includeInactive`, `starredOnly` | `courses[]{courseId, title, code?, lastUpdated, newNotifications, newBulletins, starred, active}` | `courses/v1`, `v2`, `cards/starred` |
| 5.3 | `itslearning_list_tasks` | `courseId?`, `status` (open\|all), `dueWithinDays?`, `homeworkOnly`, `activeCoursesOnly`, `limit`, `offset` | `tasks[]`, `total`, `hasMore` | `tasks/v1`, `courses/{id}/tasks/v1` |
| 5.4 | `itslearning_get_task` | `elementId` | task + `text`, `mandatory`, `submissionType`, `completionMode`, `lateSubmissionAllowed`, `hasAnswer`, `canSubmit`, `files[]`, `detailsUnavailable` | `assignments/{id}/v1` |
| 5.5 | `itslearning_list_news` | `courseId?`, `since?`, `limit` | `items[]{id, published, course, courseId?, author, text, kind, elementId?, fileRef?, bulletinId?, images?}`, `hasMore` | `notifications/stream/v2`, `courses/{id}/stream/v1` |
| 5.6 | `itslearning_list_bulletins` | `courseId`, `limit`, `offset`, `includeResources` | `bulletins[]{id, published, activeUntil, author, text, pinned, link?, images[], resources[], commentsCount}`, `total`, `hasMore` | `courses/{id}/bulletins/v1`, `courses/bulletins/{id}/elements/v1` |
| 5.7 | `itslearning_list_message_threads` | `limit`, `unreadOnly`, `type?`, `cursor?` | `threads[]{threadId, title, type, participants[], participantsCount, lastMessage, unread}`, `hasMore`, `nextCursor?` | `messagethreads/v4` |
| 5.8 | `itslearning_get_message_thread` | `threadId`, `limit`, `beforeMessageId?` | `messages[]{messageId, at, from, text, edited, deleted, system, attachment?, link?}`, `hasMore` | `messagethreads/{id}/messages/v3` |
| 5.9 | `itslearning_list_course_files` | `courseId`, `folderId?`, `recursive`, `maxDepth` | `items[]{elementId, title, kind, elementType, path, depth, parentFolderId?, homework, active, fileRef?}`, `truncated` | `courses/{id}/resources/v1`, `folders/{id}/resources/v1` |
| 5.10 | `itslearning_download_file` | `fileRef`, `mode` (auto\|text\|blob\|both), `maxTextChars` | metadata + `text` (redacted) and/or file/image content | see 5.10 |

Details:

- **Overview (5.1):** `overdue` only contains tasks from **active courses** whose deadline is at most `overdueMaxAgeDays` in the past – old, never-completed tasks from previous school years are noise for agents. Message threads are loaded first so their participants are known before task/news text is redacted. `unreadThreads` is computed from `LastReadInstantMessageId < LastMessage.MessageId` (the unread-count endpoints are not deployed).
- **Tasks (5.3/5.4):** sorted by deadline (none last). "Open" = status does not look completed. `activeCoursesOnly` restricts to tasks of `courses/v1`. If `assignments/{id}/v1` refuses access (e.g. `CustomActivity`, polls), `get_task` returns the list data with `detailsUnavailable: true`.
- **Threads (5.7):** title = thread name (redacted) → course recipients → for one-to-one/small groups the participant labels → for larger groups `Group (N participants) with Teacher X`. Groups with more than 5 participants only list teachers. `total` is only returned when itslearning provides a meaningful value (the API always reports 0 for threads/messages); `hasMore` is authoritative.
- **Messages (5.8):** chronological; deleted messages have empty text; attachments become `fileRef`s.

### 5.10 Files

**fileRefs** contain only itslearning IDs (no secrets) and are resolvable **statelessly**, i.e. also after a restart:

| fileRef | Source | Resolution |
|---|---|---|
| `e_<elementId>` | course element | `courses/resources/{id}/v1` → SSO → web session → (iframes) → `DownloadRedirect` |
| `a_<elementId>_<fileId>` | task attachment | `assignments/{id}/files/{fileId}/v1` (302) ⏳ |
| `m_<threadId>_<messageId>` | message attachment | `AttachmentUrl` (remembered or re-read from the thread) |
| `i_<courseId>_<bulletinId>_<n>` | bulletin image | `OriginalFileUrl` (remembered or re-read from the bulletins) |

Secret URLs stay inside the `FileService`. A hand-crafted fileRef grants no extra access – the server only uses the account's own permissions.

**Behaviour:**
- `mode=auto` (default): PDF/DOCX/text → **redacted text only** (privacy default, saves tokens); images → image content; other formats → file content (`resource` blob).
- The extracted text is part of `structuredContent.text` (and additionally a text content block).
- Files larger than `MAX_FILE_MB` → `FILE_TOO_LARGE`.
- Elements that are not files (links, notes, tests) → `kind: "page"` with the redacted page text, **never a URL**.
- **Before** a download the server registers everyone who might appear in the document: course participants (`courses/{id}/participants/v1`, best effort) or thread participants.
- Disk cache in `DATA_DIR/files` (24 h, max. 500 MB, oldest first).
- `DOWNLOAD_DIR`: the file is additionally stored as `<fileRef>_<redacted name>` (`savedTo`).
- **Known limit:** file/image *content* (blob) is not redacted – only extracted text is. Tool descriptions say so.

---

## 6. Redaction

Implemented in `src/redaction/`, fully unit-tested.

### 6.1 Person registry

Every person appearing in an API response is registered by `PersonId`:

| Source | Role hint |
|---|---|
| `person/v1` | `self` |
| Thread `Participants[]` (`RoleInHierarchyTitle`) | teacher/student via `TEACHER_ROLE_TITLES` |
| Thread `CreatedByTeacher` | teacher |
| Course participants (`Role`) | teacher/student via `TEACHER_ROLE_TITLES`; `FullName` split as "Last, First" or "First … Last" |
| Bulletin `PublishedBy` | weak teacher hint (only if not known as student) |
| Stream/newsfeed `PublishedBy`, message `CreatedByName` | names only |

Once a person is known as a teacher, this is remembered across restarts via `teachers.json`.

### 6.2 Labels (`REDACTION_LANGUAGE`)

| Role | `en` (default) | `de` |
|---|---|---|
| own account | `Me` | `Ich` |
| teacher with salutation | `Mrs Müller` | `Frau Müller` |
| teacher without salutation | `Teacher Müller` | `Lehrkraft Müller` |
| teacher with `REDACT_TEACHERS=true` | `Teacher-7F3A` | `Lehrkraft-7F3A` |
| student | `Student-7F3A` | `Schüler:in-7F3A` |
| unknown role | `Person-7F3A` | `Person-7F3A` |

Placeholders: `[email]`, `[phone]`, `[itslearning link]`, `[link removed]`, `[encoded data removed]`, `[name]` (de: `[E-Mail]`, `[Telefon]`, `[itslearning-Link]`, `[Link entfernt]`, `[kodierte Daten entfernt]`, `[Name]`).

The 4-character pseudonym is the start of `HMAC-SHA256(REDACTION_SECRET, baseUrl | PersonId)`; on collision it is extended to 6 characters. Pseudonyms are stable across restarts.

**Teacher directory `DATA_DIR/teachers.json`** – created and extended automatically, maintained by the user:

```json
{ "teachers": [ { "id": "A3F2C1D0", "lastName": "Müller", "salutation": "Mrs" } ] }
```

- `id` is a pseudonym key (no `PersonId`), no first names are stored.
- The legacy field `anrede` is still read.
- Changes are picked up without restart (mtime check). A broken file is never overwritten.
- The salutation is never guessed from first names – the API has no gender information.

### 6.3 Structured fields

DTOs contain people only as `Person`. Never emitted: `PersonId`, first/last/full names, `CreatedByName`, profile and avatar URLs, `HomeOrganization`, `iCalUrl*`, and every URL except those allowed in 6.5.

### 6.4 Free text

Applies to: `Text`, `RawText`, `Description`, thread names, attachment names, link titles, file names, extracted file text, page text.

Pipeline:
1. HTML → text/Markdown (scripts/styles removed, links only kept if shareable).
2. URL filters (6.5), URL-encoded data blobs → `[encoded data removed]`, ID pairs (`PersonId=123`, `"UserId": 5`) → `[ID]`.
3. E-mail addresses and phone numbers.
4. **Name dictionary** from the registry: full name, "First Last", "Last, First", "F. Last", short name; for teachers also salutation variants ("Mrs/Mr/Ms/Frau/Herr Last"); single first/last names if ≥ 3 characters and not a stop word or in `REDACTION_KEEP_WORDS`. Word-boundary based, case-insensitive, Unicode-aware, longest match first. The same spelling for two different people → `[name]`.
5. Length limit per tool.

**`REDACTION_KEEP_WORDS` trade-off:** a person's last name can also be an ordinary word (e.g. a place adjective in an event title), which then gets replaced everywhere. Listing it keeps the word – but then it is also kept where it really refers to that person.

### 6.5 Secrets and URLs

**Never emitted, never logged:** access/refresh tokens, password, API key, `iCalUrl`, SSO and session URLs (`MobileAppLoginSso`, `ProcessLogin`, `LoginSSO.aspx`, `File/View.aspx`, …), `filerepository` URLs with `Token`, signed `filecache` URLs.

**Shareable** are only external `http(s)` links (not `*.itslearning.com`) whose parameter **names and values** are unsuspicious: no secret parameter names, no JSON/markup, no person IDs, no values longer than 200 characters. Relative itslearning links (`….aspx?…`) are removed as well.

### 6.6 Logging

The logger replaces registered secrets (password, tokens, API key) and reduces URLs to patterns. Content (texts, names) is not logged, not even at `debug`.

### 6.7 Limits

- Names that never appeared in a structured field (e.g. parents, people outside the courses) are not detected in free text.
- Names in images, scans and file blobs are not redacted.
- Pseudonymisation is not anonymisation (GDPR).

---

## 7. Caching and rate limiting

| What | How |
|---|---|
| Lists | in-memory TTL cache (`CACHE_TTL_S`, 60 s); in-flight requests are shared |
| Person, courses, course participants | 15 min |
| Files | disk cache `DATA_DIR/files`, 24 h, max. 500 MB |
| Concurrency | `MAX_CONCURRENCY` (2) requests, `MIN_REQUEST_INTERVAL_MS` (200 ms) spacing – shared by REST API and web session |
| Retries | `429`/`5xx`/network: 3 attempts, exponential backoff, `Retry-After` honoured |
| Background | no requests without a tool call (except the one-time warm-up after login) |

---

## 8. Transport and operation

### 8.1 Transports

- **`stdio`** (default): for local clients (`bun src/server.ts` or `docker run -i`).
- **`http`**: Streamable HTTP at `POST /mcp`, **stateless** with JSON responses (no SSE, no sessions; `GET`/`DELETE` → 405). A fresh `McpServer` per request on top of the shared context – login, caches and person registry persist. Implemented with the SDK's web-standard transport directly on `Bun.serve` (1 MB body limit).
  - Every request needs `Authorization: Bearer <MCP_API_KEY>` (constant-time comparison).
  - `GET /healthz` without auth → `200 {"status":"ok"}`.
  - Requests with a browser `Origin` not in `MCP_ALLOWED_ORIGINS` → 403.
  - No TLS in the container – bind to localhost or put a TLS reverse proxy in front.

### 8.2 Docker

- `Dockerfile`: `oven/bun:1-alpine`, no bundling (unpdf/mammoth are imported dynamically), runs as user `bun` (UID 1000), `VOLUME /data`, `HEALTHCHECK` on `/healthz`, defaults `MCP_TRANSPORT=http`, `MCP_HOST=0.0.0.0`. Image size ~220 MB.
- `compose.yaml`: port bound to `127.0.0.1:3000`, credentials and API key as file-based secrets from `./secrets/`, read-only root filesystem, `tmpfs /tmp`, all capabilities dropped, `no-new-privileges`.
- Images are published to GHCR on version tags: `ghcr.io/ludoo0/itslearning-mcp:<version>` and `:latest` (`linux/amd64`, `linux/arm64`).

---

## 9. Error handling

| Code | Cause | Message to the agent |
|---|---|---|
| `AUTH_FAILED` | login/refresh failed for good | credentials/instance wrong |
| `SSO_NOT_SUPPORTED` | instance without native login | federated login not supported |
| `FORBIDDEN` | `403` | no access to this element |
| `NOT_FOUND` | `404` | element not found |
| `RATE_LIMITED` | `429` after retries | itslearning is throttling |
| `UPSTREAM_ERROR` | `5xx`/network after retries | itslearning unreachable |
| `FILE_REF_UNKNOWN` | invalid or no longer resolvable fileRef | fetch the list again |
| `FILE_TOO_LARGE` | > `MAX_FILE_MB` | with size |
| `NOT_A_FILE` | element/mode yields no file or text | with hint |
| `INVALID_INPUT` | schema validation | with field |

Raw API error texts (they contain IDs such as `PersonId=…`) are never passed through; they are logged sanitised only.

---

## 10. Tests

- **Unit/integration tests** (`bun test`, no network, fake data only): config, token store, API client, redaction (dictionary, URL filters, encoded blobs), person registry, teacher directory, all tools, a fake web UI reproducing the verified download chain, HTTP transport, MCP protocol in-memory, leak tests across all tools.
- **Smoke test** against a real instance (`bun run smoke [--details]`): calls every tool once, fetches the real names via the API and checks every output against them and against secret patterns. Prints counts and masked structure only (letters → `x`, digits → `9`), so its output can be shared. Exit code 1 on findings.
