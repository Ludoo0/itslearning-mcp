# itslearning-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for **itslearning**, the learning platform used by many schools. It lets AI agents (Claude, or any other MCP client) read a student's tasks, news, course announcements, messages and course files – and **redacts personal data** before anything leaves the server.

```
Agent ──MCP──▶ itslearning-mcp ──REST──▶ https://<your-school>.itslearning.com
                 │
                 └─ pseudonymises people, strips e-mail/phone/links/tokens,
                    returns slim, allowlisted results only
```

## ⚠️ Disclaimer

- **Unofficial.** This project is not affiliated with, endorsed by or supported by itslearning AS. "itslearning" is a trademark of its owner.
- It uses the **undocumented REST API of the official itslearning mobile app**, including that app's public OAuth client ID. The API can change or break at any time without notice.
- It is **read-only**: it cannot submit work, send messages or change anything.
- **You are responsible** for complying with the terms of use of your school and of itslearning, and with data-protection law (e.g. the GDPR) – especially because the data concerns minors and third parties (classmates, teachers). Only use it with an account you are entitled to use.
- **Pseudonymisation is not anonymisation.** Redaction considerably reduces what reaches an AI model, but it cannot catch everything (see [Limits](#limits)). In particular, **file and image contents are not redacted** – only extracted text is.
- Provided "as is", without warranty (see [LICENSE](LICENSE)).

## Features

- **10 read-only tools**: overview, courses, tasks (+ details), news, course announcements, message threads (+ messages), course files and file downloads.
- **Redaction by default**: the account owner becomes `Me`, teachers `Teacher Müller` (or `Mrs Müller`), classmates `Student-7F3A`; names in free text, e-mail addresses, phone numbers, internal links, tokens and encoded data blobs are removed. Labels in English (default) or German.
- **File downloads** with text extraction (PDF, DOCX, text) – the extracted text is redacted, too.
- **Two transports**: stdio for local clients, stateless Streamable HTTP with API key for Docker/remote use.
- **Gentle on the instance**: caching, rate limiting, retries with backoff, single login with a persisted, rotating refresh token.
- **Docker image** (non-root, read-only filesystem) published to GHCR.
- **Leak smoke test** against your real account that prints counts only, so you can share its output.

## Requirements

- An itslearning instance with **native login** (user name + password on the itslearning login page). Instances that only offer login via a third-party identity provider (Microsoft, Google, Feide, …) are **not supported** – the server detects this and reports `SSO_NOT_SUPPORTED`.
- A student account. Parent accounts are not supported yet (see [roadmap](docs/roadmap.md)).
- Docker, or [Bun](https://bun.sh) ≥ 1.4 to run it without Docker.

### Check your instance first

A compatibility check tells you whether itslearning-mcp can work with your school's instance – before you set anything up:

```bash
# with Docker (nothing to install)
docker run --rm -it ghcr.io/ludoo0/itslearning-mcp bun src/check/cli.ts https://yourschool.itslearning.com

# or from a clone
bun run check https://yourschool.itslearning.com
```

- **Without credentials** it checks reachability, the login method (native vs. single sign-on only), the REST API and whether the mobile-app login is accepted – the latter with a random, non-existent user name.
- **Optionally** (`--login`, or answer the prompt) it also tests your account: login, token refresh, account type, core endpoints, course participants and the file download path. Your credentials are only sent after all public checks passed and only to `*.itslearning.com`. `ITSL_USERNAME`/`ITSL_PASSWORD` from the environment are only used if `ITSL_BASE_URL` matches the checked URL.
- `--no-login` skips the account part, `--json` prints a machine-readable report.

The output contains only status codes and counts – no names or content – so you can paste it into an issue. Nothing is stored.

## Tools

| Tool | What it does |
|---|---|
| `itslearning_overview` | Starting point: overdue and upcoming tasks, recent news, unread message threads |
| `itslearning_list_courses` | Current (optionally all) courses with `courseId` and new-item counters |
| `itslearning_list_tasks` | Tasks/homework sorted by deadline; filter by course, status, due date, homework, active courses |
| `itslearning_get_task` | Task details: assignment text, deadline, submission type, attachments (`fileRef`) |
| `itslearning_list_news` | News feed across all courses or one course, optionally since a date |
| `itslearning_list_bulletins` | Announcements of a course incl. attached resources and images |
| `itslearning_list_message_threads` | Message threads with last message and unread status |
| `itslearning_get_message_thread` | Messages of a thread in chronological order, attachments as `fileRef` |
| `itslearning_list_course_files` | Folders and elements of a course (optionally recursive) with `fileRef` |
| `itslearning_download_file` | Download a file by `fileRef`: redacted text, image, or file content |

## Quick start (Docker)

```bash
git clone https://github.com/Ludoo0/itslearning-mcp.git
cd itslearning-mcp

# 1. Secrets (secrets/ is ignored by git and by the Docker build)
cp -r secrets.example secrets
#    edit secrets/itsl_username, secrets/itsl_password, secrets/mcp_api_key
#    generate an API key, e.g.:
openssl rand -hex 32

# 2. Start (prebuilt image from GHCR)
export ITSL_BASE_URL=https://yourschool.itslearning.com
docker compose pull && docker compose up -d
docker compose ps          # should become "healthy"

# …or build the image locally instead
docker compose up -d --build
```

PowerShell: `Copy-Item -Recurse secrets.example secrets` and `$env:ITSL_BASE_URL = "https://yourschool.itslearning.com"`. Compose also reads `ITSL_BASE_URL` from a `.env` file next to `compose.yaml`. Pin a version with `ITSLEARNING_MCP_VERSION=0.1.0`.

- The server listens on `http://127.0.0.1:3000/mcp` (localhost only). For access from other machines put a TLS reverse proxy in front.
- Every request needs `Authorization: Bearer <mcp_api_key>`. `GET /healthz` is unauthenticated.
- Container: Alpine, user `bun` (UID 1000), read-only root filesystem except `/data` (volume) and `/tmp`, all capabilities dropped.
- On Linux hosts the secret files must be readable by UID 1000 (`sudo chown 1000:1000 secrets/*`).

### Connect a client

**Claude Code (HTTP):**

```bash
claude mcp add --transport http itslearning http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $(cat secrets/mcp_api_key)"
```

**Claude Desktop / other stdio clients** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "itslearning": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT=stdio",
        "-e", "ITSL_BASE_URL=https://yourschool.itslearning.com",
        "-e", "ITSL_USERNAME=…",
        "-e", "ITSL_PASSWORD=…",
        "-v", "itsl-data:/data",
        "ghcr.io/ludoo0/itslearning-mcp:latest"
      ]
    }
  }
}
```

## Running locally (without Docker)

```bash
bun install
cp .env.example .env        # fill in ITSL_BASE_URL, ITSL_USERNAME, ITSL_PASSWORD
bun test

# List the tools (no login needed)
bun run call

# Call tools against your account (Bun loads .env automatically; otherwise you are prompted, password hidden)
bun run call itslearning_overview
bun run call itslearning_list_tasks limit=5
bun run call itslearning_get_task elementId=123
bun run call itslearning_list_course_files courseId=123 recursive=true
bun run call itslearning_download_file fileRef=e_123
```

Use it from Claude Code via stdio:

```bash
claude mcp add itslearning \
  -e ITSL_BASE_URL=https://yourschool.itslearning.com \
  -e ITSL_USERNAME=… -e ITSL_PASSWORD=… \
  -e DATA_DIR=/path/to/itslearning-mcp/.data \
  -- bun run /path/to/itslearning-mcp/src/server.ts
```

`DATA_DIR` (default `/data`, `.data` in `.env.example`) holds:
- `state.json` – login state (rotating refresh token; the password is never stored)
- `secret` – key for stable pseudonyms
- `teachers.json` – teacher directory (see below)
- `files/` – file cache (24 h, max. 500 MB)

## Configuration

All settings are environment variables. Variables marked *(file)* also accept `<NAME>_FILE` pointing to a file (Docker secrets), which takes precedence.

| Variable | Default | Description |
|---|---|---|
| `ITSL_BASE_URL` | **required** | Your instance, e.g. `https://yourschool.itslearning.com` |
| `ITSL_USERNAME` *(file)* | **required** | itslearning user name |
| `ITSL_PASSWORD` *(file)* | **required** | itslearning password |
| `ITSL_CLIENT_ID` | mobile app client ID | OAuth client ID |
| `MCP_TRANSPORT` | `stdio` (image: `http`) | `stdio` or `http` |
| `MCP_HOST` | `127.0.0.1` (image: `0.0.0.0`) | HTTP bind address |
| `MCP_PORT` | `3000` | HTTP port |
| `MCP_API_KEY` *(file)* | required for `http` | Bearer key for clients, ≥ 32 characters |
| `MCP_ALLOWED_ORIGINS` | empty | Allowed browser origins (comma-separated); other `Origin` headers → 403 |
| `REDACTION_LANGUAGE` | `en` | Labels and placeholders: `en` or `de` |
| `REDACTION_SECRET` *(file)* | generated | HMAC secret for pseudonyms (≥ 16 characters), stored in `DATA_DIR/secret` if not set |
| `REDACTION_KEEP_WORDS` | empty | Comma-separated words never replaced as a single name (see below) |
| `REDACT_TEACHERS` | `false` | `true` → pseudonymise teachers too (`Teacher-7F3A`) |
| `TEACHER_ROLE_TITLES` | `Teacher,Staff,Lehrer,Lehrerin,Lehrkraft,Mitarbeiter` | Role titles that count as teacher (substring, case-insensitive) |
| `MAX_FILE_MB` | `25` | Maximum download size |
| `CACHE_TTL_S` | `60` | List cache lifetime |
| `MAX_CONCURRENCY` | `2` | Parallel requests to itslearning |
| `MIN_REQUEST_INTERVAL_MS` | `200` | Minimum spacing between requests |
| `DATA_DIR` | `/data` | Persistent state, secret, teacher directory, file cache |
| `DOWNLOAD_DIR` | – | Additionally save downloaded files here (redacted file name) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Privacy and redaction

How people appear in tool output:

| Who | `REDACTION_LANGUAGE=en` | `REDACTION_LANGUAGE=de` |
|---|---|---|
| Account owner | `Me` | `Ich` |
| Teacher (salutation set) | `Mrs Müller` | `Frau Müller` |
| Teacher (no salutation) | `Teacher Müller` | `Lehrkraft Müller` |
| Teacher with `REDACT_TEACHERS=true` | `Teacher-7F3A` | `Lehrkraft-7F3A` |
| Classmate | `Student-7F3A` | `Schüler:in-7F3A` |
| Unknown role | `Person-7F3A` | `Person-7F3A` |

Placeholders: `[email]`, `[phone]`, `[itslearning link]`, `[link removed]`, `[encoded data removed]`, `[name]` (ambiguous name), `[ID]` (de: `[E-Mail]`, `[Telefon]`, `[itslearning-Link]`, `[Link entfernt]`, `[kodierte Daten entfernt]`, `[Name]`).

How it works:
- Tools return **allowlisted fields only**, never raw API responses. Person IDs and profile/avatar URLs are never emitted.
- Pseudonyms are stable (HMAC of the person ID with a local secret), so an agent can tell that two messages come from the same person.
- Names in free text (tasks, news, messages, thread titles, file names, extracted file text) are replaced using a dictionary of every person the server knows: participants of recent message threads (loaded at startup), course participants (loaded before course content) and every person in API responses.
- E-mail addresses, phone numbers, itslearning links, tokens, ID pairs and URL-encoded data are removed. External links are kept only if their parameters look harmless.

### Teacher salutations

Teachers are added automatically to `DATA_DIR/teachers.json` (last name only – no first names, no IDs):

```json
{ "teachers": [ { "id": "A3F2C1D0", "lastName": "Müller", "salutation": "" } ] }
```

Set `salutation` (e.g. `"Mrs"`, `"Mr"`, `"Frau"`, `"Herr"`) and the agent sees `Mrs Müller`; leave it empty for `Teacher Müller`. Changes apply without restart. The salutation is never guessed. In Docker: `docker compose exec itslearning-mcp vi /data/teachers.json`.

### `REDACTION_KEEP_WORDS`

A person's last name can also be an ordinary word (e.g. a place adjective in an event title) and would then be replaced everywhere. Words listed in `REDACTION_KEEP_WORDS` are never replaced as a single name – but then also not where they really refer to that person. Full names are still replaced. Set it via `.env`/compose, not in the repository.

### Limits

- Names that never appear in a structured field (e.g. parents, people outside your courses) are not detected in free text.
- **Images and file contents (blobs) are not redacted**, only extracted text. With `mode=auto`, PDFs/DOCX/text files are returned as redacted text only.
- Pseudonymisation is not anonymisation – think about which data you send to an AI model at all.

## Files

Tools return `fileRef` values: `e_<id>` course element, `a_<task>_<file>` task attachment, `m_<thread>_<message>` message attachment, `i_<course>_<bulletin>_<n>` announcement image. They contain no secrets and stay valid across restarts.

`itslearning_download_file` modes:

| `mode` | Result |
|---|---|
| `auto` (default) | PDF/DOCX/text → **redacted text**; images → image; other formats → file |
| `text` | redacted text only |
| `blob` | file only (not redacted) |
| `both` | file + redacted text |

Elements that are not files (links, notes, tests) return `kind: "page"` with the redacted page text.

## Smoke test against your account

```bash
bun run smoke             # calls every tool once and checks all output for leaks
bun run smoke --details   # additionally shows masked findings (e.g. "S****") and their structure
```

The script fetches the real names (own account, threads, news, course participants) directly from the API and checks whether any of them – or tokens, session URLs, e-mail addresses, person IDs – appear in tool output. **Its output contains counts and masked structure only** (letters → `x`, digits → `9`), so it can be shared in issues. Exit code 1 on findings.

## Development

```bash
bun install
bun run typecheck
bun test
```

- Architecture, invariants and conventions: [CONTRIBUTING.md](CONTRIBUTING.md), [CLAUDE.md](CLAUDE.md)
- Specification: [docs/mcp-server-spec.md](docs/mcp-server-spec.md)
- API findings: [docs/itslearning-api.md](docs/itslearning-api.md)
- Roadmap: [docs/roadmap.md](docs/roadmap.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)

`scripts/dev/probe.ts` (`bun run probe`) is the exploration script used to map the API; its report contains structure only.

## Security

Please report vulnerabilities – especially redaction leaks – privately as described in [SECURITY.md](SECURITY.md). Never post real student data in issues.

## License

[MIT](LICENSE)
