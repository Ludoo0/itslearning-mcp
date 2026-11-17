# Security policy

This server processes personal data of students, classmates and teachers. Redaction failures are treated as security issues.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

**Do not open a public issue for security problems or redaction leaks.**

Report privately via GitHub: **Security → Advisories → [Report a vulnerability](https://github.com/Ludoo0/itslearning-mcp/security/advisories/new)** (private vulnerability reporting).

Please include:
- the affected version/commit and transport (stdio/HTTP, Docker or local),
- which tool and which kind of data is affected,
- a description of the pattern – **never real names, messages, files or other student data**. If you found a leak with the smoke test, the output of `bun run smoke --details` is safe to share: it contains counts and masked structure only (letters → `x`, digits → `9`).
- if possible, a reproduction with fictional data (see `test/fixtures.ts`).

You can expect an acknowledgement within a few days. Fixes for confirmed issues are released as soon as possible and credited in the changelog unless you prefer otherwise.

## What counts as a security issue

- **Redaction leaks:** real names, e-mail addresses, phone numbers, person IDs or other personal data in tool output that should have been redacted.
- **Secret leaks:** access/refresh tokens, passwords, API keys, SSO/session URLs, tokenized file URLs or the iCal URL in tool output or logs.
- **Authentication issues:** bypassing the HTTP API key, origin check or other access control of the server.
- Anything that makes the server perform write operations on itslearning.

Not in scope: weaknesses of itslearning itself (report those to itslearning), and the documented limits of redaction (unknown names in free text, content of images/file blobs – see the README).

## Hardening recommendations

- Keep the HTTP port bound to localhost, or put a TLS reverse proxy in front; use a long random `MCP_API_KEY`.
- Store credentials as Docker secrets or in a `.env` file that is never committed.
- Keep `DATA_DIR` private – it contains the refresh token and the pseudonym secret.
