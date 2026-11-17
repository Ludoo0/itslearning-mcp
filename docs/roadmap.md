# Roadmap

Open items after v0.1.0. Background: [`mcp-server-spec.md`](./mcp-server-spec.md), [`itslearning-api.md`](./itslearning-api.md).

> When documenting findings from a real instance, describe patterns only – never names, IDs or course titles.

## Next (v0.2)

### Verify the task details fallback against a real instance
Implemented (task page text via web session, `detailsSource: "page"`), tested with fake pages only. Check with real polls/choices and `CustomActivity` tasks how much interface text remains in `text` and whether the page structure needs more filtering.

### Element type mapping (`LearningToolId`)
`itslearning_list_course_files` cannot tell files, links, pages and tests apart up front – all non-folders are `LearningToolElement`; only `LearningToolId` (or the `ExtensionId` in `IconUrl`) distinguishes them. Collect the mapping from real instances and expose a `kind` such as `file` / `link` / `page` / `test`.

### Faster course-file downloads
The download chain needs about 8 requests per file. `LearningObjectId` and `LearningObjectInstanceId` from the resources API match the parameters of `Proxy/DownloadRedirect.ashx`. Once a `resource.itslearning.com` session exists, calling `DownloadRedirect.ashx` directly could save ~6 requests per file. Needs verification.

### Verify task attachments
`a_<elementId>_<fileId>` references are implemented from the API documentation only (`assignments/{id}/files/{fileId}/v1` → 302). The exact shape of `Files[]`/`TemplateFile` is unverified – test against a task that actually has attachments.

## Later (v1+)

- **Parent accounts:** the API has `children/{childId}/courses|tasks|plans|upcoming` endpoints; support selecting a child.
- **Calendar:** `calendar/events/v1?fromDate=…` and course calendar events (unused at the reference instance, so untested with data).
- **Weekly plans:** `planner/v1`, `children/{id}/plans/v1`.
- **SSO instances:** optional login via a headless browser for instances that only offer federated login (Microsoft, Google, Feide, …).
- **More redaction languages** beyond `en`/`de` (labels live in `src/redaction/labels.ts`).
