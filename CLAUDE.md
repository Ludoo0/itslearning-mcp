# itslearning-mcp – context for agents

Read-only MCP server for **itslearning** (a learning platform used by schools) that lets AI agents read the tasks, news, messages and files of a student account – with **redaction of personal data**. Works with any itslearning instance that offers native login (`ITSL_BASE_URL`).

- **Open items:** [`docs/roadmap.md`](docs/roadmap.md)
- Specification (as built): [`docs/mcp-server-spec.md`](docs/mcp-server-spec.md)
- Verified API findings (endpoints, auth, download flows): [`docs/itslearning-api.md`](docs/itslearning-api.md)
- Usage/operation: [`README.md`](README.md) · Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md) · Security: [`SECURITY.md`](SECURITY.md)

Project language: **English** (code, comments, docs, tool descriptions, error messages, commit messages). Redaction labels exist in `en` (default) and `de`.

## Privacy – hard rules

This project was developed and tested against a real student account. **Never commit anything identifying an instance, school, person or course.**

- **Never in the repository:** instance URLs, school names or locations, customer IDs; real names, course titles, element/person IDs from any account; content of `probe-output/`, `.data/`, `downloads/`, `secrets/`, `.env` (all gitignored).
- Before every commit, search the staged diff for identifying terms (`git diff --cached | grep -nE '<instance>|<school>|<city>|<customerId>'` – the maintainer knows the concrete terms; do not write them down here).
- **Test data is fictional** (`test/fixtures.ts`, `test/fakeWeb.ts`: "Jonas Beispielmann", "Sabine Lindqvist", …). Never put real data into tests.
- **Never run `bun run check`, `call`, `smoke` or `probe` against placeholder/example URLs while a `.env` with real credentials is present**, and never build shell commands from text that contains backticks (e.g. Markdown) – use file-editing tools for docs.
- **Bun loads `.env` automatically** – a developer's `.env` may contain real credentials. When starting the server or scripts locally without intending to use the real account, explicitly override `ITSL_BASE_URL`/`ITSL_USERNAME`/`ITSL_PASSWORD` with dummy values (e.g. `ITSL_BASE_URL=https://example.itslearning.com`) and point `DATA_DIR` to a scratch directory. Tests against a real account are run by the maintainer (`bun run call …`, `bun run smoke`) or via the connected MCP server.
- Output meant to be shared (reports, smoke test) contains **structure/counts only**, never content – see `scripts/smokeCore.ts` (masking `x`/`9`).
- When real (redacted) data reaches the chat through the MCP tools: describe patterns only in reports, never copy names/course titles into files.

## Architecture (short)

Bun + TypeScript (strict) + `@modelcontextprotocol/sdk` + `zod`. No build step; `bun src/server.ts`.

| Path | Content |
|---|---|
| `src/server.ts` | Entry point; `MCP_TRANSPORT=stdio` (default) or `http` |
| `src/http.ts` | Streamable HTTP on `Bun.serve`, stateless (fresh `McpServer` per request on a shared context), bearer API key, `/healthz`, origin check |
| `src/app.ts` | Wiring (`createApp`), server instructions, tool registration |
| `src/context.ts` | `AppContext`, `ensureReady()` (login, own account as "Me", warm up the name dictionary with thread participants) |
| `src/auth/` | OAuth2 password grant with the mobile app's client ID, **rotating refresh token** → `DATA_DIR/state.json`; wrong password = fatal (no retry, avoid account lockout) |
| `src/api/` | REST client (limiter, TTL cache, retries), typed endpoints |
| `src/redaction/` | Person registry (roles, HMAC pseudonyms), labels (`labels.ts`, en/de), `teachers.json` (salutation, hot reload), name dictionary, secret/URL filters, HTML → text |
| `src/files/`, `src/websession/` | fileRefs (`e_`/`a_`/`m_`/`i_`, stateless), download flows (SSO → web session → iframes → `DownloadRedirect`), text extraction (unpdf, mammoth), disk cache |
| `src/tools/` | One module per tool group; DTOs are **allowlists** (never pass raw API responses through) |
| `src/check/` | Compatibility check (`bun run check <url>`; part of the Docker image): public checks + optional account checks, status/counts only |
| `src/cli/` | Shared terminal prompts (hidden password input) |
| `scripts/` | `call.ts` (call a tool against a real instance), `smoke.ts`/`smokeCore.ts` (leak check), `dev/probe.ts` (API exploration) |

### Invariants
- **Register people first, then redact text** (`registerThread`, `registerPublishedBy`, `warmCourse`/`warmForFileRef` in `src/tools/people.ts`).
- Every free text goes through `ctx.redactor.text()` or `.title()`; file names through `redactFileName()`.
- Secret URLs (tokens, SSO/session URLs, filerepository/filecache links) never leave `FileService`/`websession` and are never logged (the logger scrubs registered secrets and URLs).
- External links only if `isShareableUrl()` (checks host, parameter names **and values**).
- Logs go to stderr (stdout belongs to the MCP protocol with stdio); never log content.
- Some clients (Claude Code) only show `structuredContent` of a tool result → everything the agent must see belongs in `structuredContent`.

## Commands

```bash
bun install
bun run typecheck
bun test                         # unit/integration tests, fake data only, no network
bun run call [tool] [key=value…] # call a tool against a real instance (uses .env or prompts)
bun run smoke --details          # leak check against a real instance, output is shareable
docker compose up -d --build     # HTTP server on 127.0.0.1:3000 (secrets in ./secrets/)
```

The maintainer has the server connected in Claude Code as MCP server `itslearning` (HTTP, Docker). After code changes the container must be rebuilt for the connected server to pick them up.

## Working with the maintainer

- Commits, pushes and any other git/GitHub write operation only after explicit approval (global rules in `~/.claude/CLAUDE.md`). The main branch is **`master`**; remote `origin` = GitHub repository.
- Real-account tests (login, smoke test) are run by the maintainer in their own terminal; they share the (shareable) output.
- For every redaction gap found: reproduce the cause with a structure-only diagnosis, write a regression test with fictional data, then fix.
