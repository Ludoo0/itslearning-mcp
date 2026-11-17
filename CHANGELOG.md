# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Developer script `bun run call` to call tools against a real instance; API probe scripts.

### Fixed

- Extracted file text is now part of `structuredContent` – clients that only show structured content (e.g. Claude Code) did not see it before.
- `itslearning_overview` only lists overdue tasks from active courses and at most `overdueMaxAgeDays` (default 60) in the past, instead of never-completed tasks from previous school years.
- `itslearning_list_tasks` has a new `activeCoursesOnly` filter.
- Group message threads without a name get a readable title (`Group (N participants) with Teacher X`) instead of a list of pseudonyms.
- `total` for message threads and messages is only returned when itslearning reports a meaningful value (the API always reports 0).

[Unreleased]: https://github.com/Ludoo0/itslearning-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ludoo0/itslearning-mcp/releases/tag/v0.1.0
