# Roadmap

Open items after v0.3.1. Background: [`mcp-server-spec.md`](./mcp-server-spec.md), [`itslearning-api.md`](./itslearning-api.md). What has been released is listed in the [CHANGELOG](../CHANGELOG.md).

> When documenting findings from a real instance, describe patterns only – never names, IDs or course titles.

## Next (v0.4)

### Element type mapping (`LearningToolId`)
`itslearning_list_course_files` cannot tell files, links, pages and tests apart up front – all non-folders are `LearningToolElement`; only `LearningToolId` (or the `ExtensionId` in `IconUrl`) distinguishes them. `bun run element-types` (`scripts/dev/element-types.ts`) lists the `LearningToolId` / `ExtensionId` combinations of an account with counts and file extensions from titles only – its output can be shared.

Done: `5009` is mapped to `kind: "file"` (reference instance: ~92 % of all course elements, titles almost all `.pdf`/images/`.mp4`); `CustomActivity` → `activity`. Still open: further ids observed at the reference instance without file extensions – `5010` (12×), `5006` (9×, titles with years/numbers), `5050` (3×), `5` (4×), `5002` (1×) – and `5017` (2×, titles `.docx`, possibly a cloud/Office document). Check what they are in the web interface (e.g. via `itslearning_download_file`, which reports `kind: "page"` for non-files) and extend `FILE_TOOL_IDS` / add `link` / `page` / `test` kinds in `src/tools/files.ts`.

### Verify task attachments
`a_<elementId>_<fileId>` references are implemented from the API documentation only (`assignments/{id}/files/{fileId}/v1` → 302). The exact shape of `Files[]`/`TemplateFile` is unverified – test against a task that actually has attachments.

### Task page fallback for polls and choices
Since v0.2.0, `itslearning_get_task` reads the instructions from the task's web page when the assignment API refuses details. Verified against a real instance with a `CustomActivity` task (clean text, redacted). Still to check: `LearningToolElement`-based tasks that are refused as well (e.g. polls or project selections) – their pages are embedded via iframes and may contain more interface text or form elements.

## Implemented, awaiting verification against real data

Built from the public API help pages and tested with fictional data only. Findings from a real instance (structure/counts only) are welcome.

### Calendar (`itslearning_list_calendar`)
`calendar/events/v1?fromDate=…` and `courses/{id}/calendarevents/v1?fromDate=…&toDate=…`. The reference instance has no events. To verify with an instance that uses the calendar: field names (`EventId`/`Id`, `FromDate`, `ToDate`, `EventTitle`, `Description`, `EventType`, `LocationId`, `LocationTitle`), paging, and the redaction of descriptions.

### Weekly plans (`itslearning_list_plans`)
`planner/v1?courseId=…&startDate=…&stopDate=…` and `planner/plansinfo/v1?plansIds[0]=…`. At the reference instance a student account gets `403 "User does not have access to plans"` for every course. To verify with an instance where plans are visible: date handling (time part, UTC vs. local time), the shape of `plansinfo` (topic, learning objectives, `Elements[].Type`), whether the `e_` fileRefs of plan elements download, and the number of requests with many courses.

### Parent accounts (experimental)
`itslearning_list_children` and `childId` for `itslearning_list_tasks`, `itslearning_list_courses` and `itslearning_overview` (`children/v1`, `children/{id}/courses/v1`, `children/{id}/tasks/v1`, `children/{id}/courses/{courseId}/tasks/v1`). To verify with a real parent account: login, child fields (`PersonId`, names), course teachers (`Teachers[]`), task fields, whether course participants are readable for parents (free-text redaction relies on them), and a smoke test. Not covered yet: task details for children (`itslearning_get_task`), `children/{id}/plans|upcoming`.

## Later (v1+)

- **SSO instances:** optional login via a headless browser for instances that only offer federated login (Microsoft, Google, Feide, …).

## Done

- **Download shortcut (dropped):** calling `DownloadRedirect.ashx` directly with the ids from the resources API is not possible – the API reports `LearningObjectId`/`LearningObjectInstanceId` as `0` (see `itslearning-api.md`).
- **More redaction languages:** `en`, `de`, `nb`, `sv`, `nl`, `fr` (`src/redaction/labels.ts`). More languages are welcome – a label set in `labels.ts` plus salutations in `src/redaction/freetext.ts`.
