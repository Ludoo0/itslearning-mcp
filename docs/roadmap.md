# Roadmap

Open items after v0.2.0. Background: [`mcp-server-spec.md`](./mcp-server-spec.md), [`itslearning-api.md`](./itslearning-api.md). What has been released is listed in the [CHANGELOG](../CHANGELOG.md).

> When documenting findings from a real instance, describe patterns only – never names, IDs or course titles.

## Next (v0.3)

### Element type mapping (`LearningToolId`)
`itslearning_list_course_files` cannot tell files, links, pages and tests apart up front – all non-folders are `LearningToolElement`; only `LearningToolId` (or the `ExtensionId` in `IconUrl`) distinguishes them. Collect the mapping from real instances and expose a `kind` such as `file` / `link` / `page` / `test`. `bun run element-types` (`scripts/dev/element-types.ts`) lists the `LearningToolId` / `ExtensionId` combinations of an account with counts and file extensions from titles only – its output can be shared.

### Faster course-file downloads
The download chain needs about 8 requests per file. `LearningObjectId` and `LearningObjectInstanceId` from the resources API match the parameters of `Proxy/DownloadRedirect.ashx`. Once a `resource.itslearning.com` session exists, calling `DownloadRedirect.ashx` directly could save ~6 requests per file. Needs verification.

### Verify task attachments
`a_<elementId>_<fileId>` references are implemented from the API documentation only (`assignments/{id}/files/{fileId}/v1` → 302). The exact shape of `Files[]`/`TemplateFile` is unverified – test against a task that actually has attachments.

### Task page fallback for polls and choices
Since v0.2.0, `itslearning_get_task` reads the instructions from the task's web page when the assignment API refuses details. Verified against a real instance with a `CustomActivity` task (clean text, redacted). Still to check: `LearningToolElement`-based tasks that are refused as well (e.g. polls or project selections) – their pages are embedded via iframes and may contain more interface text or form elements.

## Later (v1+)

- **Parent accounts:** the API has `children/{childId}/courses|tasks|plans|upcoming` endpoints; support selecting a child.
- **Calendar:** `calendar/events/v1?fromDate=…` and course calendar events (unused at the reference instance, so untested with data).
- **Weekly plans:** `planner/v1`, `children/{id}/plans/v1`.
- **SSO instances:** optional login via a headless browser for instances that only offer federated login (Microsoft, Google, Feide, …).
- **More redaction languages** beyond `en`/`de` (labels live in `src/redaction/labels.ts`).
