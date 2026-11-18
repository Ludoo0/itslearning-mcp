# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- A teacher's first name on its own was replaced by the teacher's display (`Teacher <last name>`). When the same first name belonged to someone else – e.g. a public figure quoted in course material – the output read `Teacher <last name> <other last name>` and revealed the teacher's full name. A teacher's first name alone now becomes the neutral label (`[name]`); full name, `F. Last`, salutation + last name and the last name alone still map to the teacher. Students and the account owner are unchanged (their display is a pseudonym).

## [0.3.2] - 2026-11-18

### Fixed

- Regression in 0.3.1: short parts of compound names (e.g. the preposition in `Auf der …`) were registered as names, so ordinary words like `auf` were replaced by a pseudonym in free text. Parts of compound names now need at least 4 letters to be matched on their own; the full name and longer parts are still replaced.

## [0.3.1] - 2026-11-18

### Security

- Free-text redaction missed names written in a different spelling than the itslearning profile (GHSA-mjg7-6rhp-q6c9): the name dictionary now matches case- **and diacritic-insensitively** (`Ibáñez` = `Ibanez`, `Ødegård` = `Odegard`, decomposed input), also accepts German transliterations (`Müller` = `Mueller`), and registers the **parts of compound names** (`Ibáñez Olmedo`, `Lindqvist-Ødegård`, `Anna-Lena`) as single names, with first name, initial and – for teachers – salutation. Name particles (`von`, `van`, `der`, `de`, …) are never replaced on their own; a part shared by several people becomes the neutral label.

## [0.3.0] - 2026-11-18

### Added

- `itslearning_list_calendar`: calendar events in a period (`from`, `days` default 14, max. 90, `limit`), across all courses (`calendar/events/v1`, `fromDate` is required) or for one course (`courseId` → `courses/{id}/calendarevents/v1`); returns `from`, `to`, `total`, `hasMore`. Unverified against real data (the reference instance has no calendar events).
- `itslearning_list_plans`: weekly/lesson plans from the course planner (`planner/v1`, which requires a `courseId` – without `courseId` all current courses are queried, failing courses are counted in `unavailableCourses`); with `includeDetails` (default `true`) topic, learning objectives and attached elements with `e_` fileRefs via `planner/plansinfo/v1`. At the reference instance a student account gets `403` for the planner of every course (reported as `unavailableCourses`, logged at debug level).
- **Experimental** parent-account support, not verified against a real parent account: new tool `itslearning_list_children` (children as pseudonyms `Child-XXXX`, with a pseudonymous `childId` key – never the person ID); optional `childId` for `itslearning_list_tasks`, `itslearning_list_courses` and `itslearning_overview` (default: the only child; several children → `INVALID_INPUT`; ignored for student accounts). Teachers of the child's courses are registered before redaction. Limitations: `itslearning_get_task` does not support child tasks, child courses have no counters/favorites/former courses, news and messages in the overview stay the parent's own.
- Redaction labels in Norwegian Bokmål (`nb`), Swedish (`sv`), Dutch (`nl`) and French (`fr`) besides `en`/`de`; unknown `REDACTION_LANGUAGE` values are a configuration error. New person role `child` (`Child-XXXX`, de `Kind-XXXX`, …). Additional teacher salutations recognised in free text: `Fru`, `Fröken`, `Mevrouw`, `Mevr.`, `Mw.`, `Meneer`, `Dhr.`, `Juf`, `Juffrouw`, `Meester`, `Madame`, `Mme`, `Mademoiselle`, `Mlle`, `Monsieur`, `M.`.

### Changed

- The expected `403`/`404` of the assignment API for task types it does not describe is logged at debug level instead of as a warning (`itslearning_get_task` falls back to the task page; a failing fallback still logs a warning).
- `itslearning_list_course_files`: `kind` is now `file` (verified file elements, `LearningToolId` 5009), `activity`, `folder` or `other` instead of the generic `element`; elements expose their `learningToolId`. Other ids (links, pages, tests, …) are not mapped yet.
- New developer script `bun run element-types` to collect `LearningToolId` / `ExtensionId` combinations of an account (counts and file extensions only).

## [0.2.0] - 2026-11-18

### Added

- `itslearning_get_task`: for task types the assignment API does not describe (polls, choices, `CustomActivity`), the instructions are now read from the task's web page via the web session and returned redacted as `text` with `detailsSource: "page"`. `detailsUnavailable` is only `true` if no text could be obtained at all.
- The smoke test checks the details of several tasks (preferring activities) and reports how many texts came from the task page.

### Changed

- HTML → text conversion drops page chrome (`nav`, `header`, `footer`) as well as `noscript`, `template` and `svg` content, normalises CRLF line breaks, removes empty list items and keeps list item content on the bullet line.
- Docker base image pinned to `oven/bun:1.4.4-alpine` (same Bun version as CI).
- Dependencies: TypeScript 7 for type checking; GitHub Actions updated (`actions/checkout@v7`, Docker actions to their Node 24 majors).
- Development: Biome for linting and formatting (`bun run lint` in CI, `bun run format`); Dependabot version updates for Bun, GitHub Actions and Docker; the release workflow can be started manually as a dry run (full pipeline, nothing published).

### Fixed

- HTML sanitisation removes nested or overlapping markup completely, and HTML entities in links are no longer decoded twice (CodeQL `js/incomplete-multi-character-sanitization`, `js/double-escaping`). Output is plain text for agents, so the practical impact was low.

## [0.1.0] - 2026-11-17

First public release.

### Added

- Read-only MCP server for itslearning with 10 tools: `itslearning_overview`, `itslearning_list_courses`, `itslearning_list_tasks`, `itslearning_get_task`, `itslearning_list_news`, `itslearning_list_bulletins`, `itslearning_list_message_threads`, `itslearning_get_message_thread`, `itslearning_list_course_files`, `itslearning_download_file`.
- Login via the OAuth2 password grant of the itslearning mobile app API; rotating refresh token persisted in `DATA_DIR/state.json`; single-flight refresh; wrong password is treated as fatal to avoid account lockouts; detection of SSO-only instances (`SSO_NOT_SUPPORTED`).
- Redaction of personal data:
  - person registry with role detection (thread roles, course roles, `CreatedByTeacher`, bulletin authors) and stable HMAC pseudonyms,
  - labels in English (default) and German via `REDACTION_LANGUAGE`,
  - teacher directory `teachers.json` with user-maintained salutations (hot reload),
  - name dictionary for free text, warmed up with thread and course participants,
  - removal of e-mail addresses, phone numbers, internal/relative itslearning links, tokens, ID pairs and URL-encoded data blobs; external links only with harmless parameter values,
  - `REDACTION_KEEP_WORDS` to keep ordinary words that collide with names,
  - `REDACT_TEACHERS` to pseudonymise teachers as well.
- File downloads via stateless `fileRef`s: course elements (SSO → web session → `DownloadRedirect`), task attachments, message attachments, announcement images; text extraction for PDF (unpdf), DOCX (mammoth) and text files; disk cache; size limit; optional `DOWNLOAD_DIR`.
- Transports: stdio and stateless Streamable HTTP (`POST /mcp`) with bearer API key, `/healthz` and origin check.
- REST client with rate limiting, TTL cache, retries with backoff and sanitised error mapping.
- Docker image (Alpine, non-root, read-only root filesystem, health check) and `compose.yaml` with file-based secrets; images published to `ghcr.io/ludoo0/itslearning-mcp` for `linux/amd64` and `linux/arm64`.
- Smoke test (`bun run smoke`) that checks all tool output of a real account against real names and secret patterns and prints counts/masked structure only.
- Compatibility check (`bun run check <url>`, also inside the Docker image): public checks without credentials, optional account checks; credentials are only sent to `*.itslearning.com` after all public checks passed; prints status and counts only.
- Developer script `bun run call` to call tools against a real instance; API probe script (`bun run probe`).

### Fixed

- Extracted file text is now part of `structuredContent` – clients that only show structured content (e.g. Claude Code) did not see it before.
- `itslearning_overview` only lists overdue tasks from active courses and at most `overdueMaxAgeDays` (default 60) in the past, instead of never-completed tasks from previous school years.
- `itslearning_list_tasks` has a new `activeCoursesOnly` filter.
- Group message threads without a name get a readable title (`Group (N participants) with Teacher X`) instead of a list of pseudonyms.
- `total` for message threads and messages is only returned when itslearning reports a meaningful value (the API always reports 0).

[Unreleased]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ludoo0/itslearning-mcp/releases/tag/v0.1.0
