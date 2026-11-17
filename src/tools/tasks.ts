import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiAssignment, ApiTask } from "../api/types";
import type { AppContext } from "../context";
import { ToolError } from "../errors";
import { canExtractText, extractText } from "../files/extract";
import { type FileRefDto, formatRef } from "../files/refs";
import { log } from "../log";
import { redactFileName } from "./files";
import { warmCourses } from "./people";
import { handler, ok } from "./result";

/** Status values treated as done (only "NotStarted" has been observed so far; more values ⏳). */
const DONE_RE = /complet|done|finished|evaluat|submitted|assessed/i;
const PREVIEW_LEN = 300;
const TEXT_LEN = 20_000;

export type TaskDto = {
  taskId: number;
  elementId: number;
  title: string;
  course: string;
  courseId?: number;
  deadline: string | null;
  overdue: boolean;
  status: string;
  homework: boolean;
  type: "assignment" | "activity" | "other";
  descriptionPreview?: string;
};

function taskType(t: { ElementType?: string | null }): TaskDto["type"] {
  if (t.ElementType === "LearningToolElement") return "assignment";
  if (t.ElementType === "CustomActivity") return "activity";
  return "other";
}

export const courseIdOf = (t: ApiTask) => (t.LocationId && /course/i.test(t.LocationType ?? "") ? t.LocationId : undefined);
const isOpen = (t: ApiTask) => !DONE_RE.test(t.Status ?? "");
export const deadlineMs = (d?: string | null) => {
  if (!d) return undefined;
  const ms = Date.parse(d);
  return Number.isFinite(ms) ? ms : undefined;
};

/** Ids of the account's current courses (courses/v1). Tasks without a course are not affected by filters on this. */
export async function activeCourseIds(ctx: AppContext): Promise<Set<number>> {
  return new Set((await ctx.it.courses(false)).map((c) => c.CourseId));
}

export function toTaskDto(ctx: AppContext, t: ApiTask): TaskDto {
  const due = deadlineMs(t.Deadline);
  const preview = ctx.redactor.text(t.Description, PREVIEW_LEN);
  const courseId = courseIdOf(t);
  return {
    taskId: t.TaskId,
    elementId: t.ElementId,
    title: ctx.redactor.title(t.Title),
    course: ctx.redactor.title(t.LocationTitle),
    ...(courseId ? { courseId } : {}),
    deadline: t.Deadline ?? null,
    overdue: due !== undefined && due < ctx.now().getTime() && isOpen(t),
    status: t.Status ?? "Unknown",
    homework: t.Homework ?? false,
    type: taskType(t),
    ...(preview ? { descriptionPreview: preview } : {}),
  };
}

// ---------- list_tasks ----------

export const listTasksInput = {
  courseId: z.number().int().positive().optional().describe("Only tasks of this course"),
  status: z.enum(["open", "all"]).default("open").describe("open = not done yet (including overdue)"),
  dueWithinDays: z.number().int().min(0).max(365).optional().describe("Only tasks due within the next N days (including overdue ones)"),
  homeworkOnly: z.boolean().default(false).describe("Only tasks marked as homework"),
  activeCoursesOnly: z.boolean().default(false).describe("Only tasks from current courses (hides leftovers from previous school years)"),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
};
type ListTasksArgs = {
  courseId?: number;
  status?: "open" | "all";
  dueWithinDays?: number;
  homeworkOnly?: boolean;
  activeCoursesOnly?: boolean;
  limit?: number;
  offset?: number;
};

export async function listTasks(ctx: AppContext, args: ListTasksArgs) {
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const raw = args.courseId ? await ctx.it.courseTasks(args.courseId) : await ctx.it.tasks();
  const nowMs = ctx.now().getTime();

  let tasks = raw;
  if ((args.status ?? "open") === "open") tasks = tasks.filter(isOpen);
  if (args.homeworkOnly) tasks = tasks.filter((t) => t.Homework);
  if (args.activeCoursesOnly) {
    const active = await activeCourseIds(ctx);
    tasks = tasks.filter((t) => {
      const c = courseIdOf(t);
      return c === undefined || active.has(c);
    });
  }
  if (args.dueWithinDays !== undefined) {
    const until = nowMs + args.dueWithinDays * 86_400_000;
    tasks = tasks.filter((t) => {
      const due = deadlineMs(t.Deadline);
      return due !== undefined && due <= until;
    });
  }
  tasks = [...tasks].sort((a, b) => (deadlineMs(a.Deadline) ?? Infinity) - (deadlineMs(b.Deadline) ?? Infinity));

  const pageRaw = tasks.slice(offset, offset + limit);
  await warmCourses(ctx, pageRaw.map(courseIdOf));
  const page = pageRaw.map((t) => toTaskDto(ctx, t));
  return { tasks: page, total: tasks.length, hasMore: offset + page.length < tasks.length };
}

// ---------- get_task ----------

/**
 * Task attachments → fileRefs. The exact shape of the file objects is not verified yet (⏳),
 * so this is tolerant: FileId/Id as id, FileName/Name/Title as name.
 */
export function assignmentFiles(ctx: AppContext, elementId: number, a: ApiAssignment): FileRefDto[] {
  const raw = [...(Array.isArray(a.Files) ? a.Files : []), ...(a.TemplateFile ? [a.TemplateFile] : [])];
  const out: FileRefDto[] = [];
  raw.forEach((f, i) => {
    if (!f || typeof f !== "object") return;
    const o = f as Record<string, unknown>;
    const fileId = typeof o.FileId === "number" ? o.FileId : typeof o.Id === "number" ? o.Id : undefined;
    if (fileId === undefined) return;
    const name =
      [o.FileName, o.Name, o.Title].find((v): v is string => typeof v === "string" && v.trim() !== "") ??
      `${ctx.redactor.labels.attachment} ${i + 1}`;
    out.push({ fileRef: formatRef({ kind: "assignment", elementId, fileId }), name: redactFileName(ctx, name), kind: "file" });
  });
  return out;
}

export const getTaskInput = {
  elementId: z.number().int().positive().describe("elementId from itslearning_list_tasks"),
};

/**
 * Redacted text of a task's itslearning web page (fallback when the assignment API refuses details).
 * The page may contain UI labels besides the task text. Best effort: errors return undefined.
 * Course participants are already registered by the caller (warmCourses) before redaction.
 */
async function taskPageText(ctx: AppContext, t: ApiTask): Promise<string | undefined> {
  const target = t.ContentUrl || t.Url;
  if (!target) return undefined;
  try {
    const r = await ctx.files.fetchPage(formatRef({ kind: "element", elementId: t.ElementId }), target, t.Title);
    let raw: string | undefined;
    if (r.type === "page") raw = r.html;
    else if (canExtractText(r.mimeType, r.name)) raw = await extractText(r.data, r.mimeType, r.name);
    const text = raw ? ctx.redactor.text(raw, TEXT_LEN) : "";
    return text.trim() ? text : undefined;
  } catch (e) {
    log.warn("Task page not available", { code: e instanceof ToolError ? e.code : "error" });
    return undefined;
  }
}

export async function getTask(ctx: AppContext, args: { elementId: number }) {
  const base = (await ctx.it.tasks()).find((t) => t.ElementId === args.elementId);
  if (base) await warmCourses(ctx, [courseIdOf(base)]);

  let a: Awaited<ReturnType<AppContext["it"]["assignment"]>> | undefined;
  try {
    a = await ctx.it.assignment(args.elementId);
  } catch (e) {
    // CustomActivity and similar: details not readable via the API → base data from the task list
    if (!(e instanceof ToolError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND") && base)) throw e;
  }
  if (!a && !base) throw new ToolError("NOT_FOUND", "Task not found.");

  // Fallback: the API refuses details for some task types → read the task's web page instead
  const pageText = !a && base ? await taskPageText(ctx, base) : undefined;

  const baseDto = base ? toTaskDto(ctx, base) : undefined;
  const files = a ? assignmentFiles(ctx, args.elementId, a) : [];
  const deadline = a?.Deadline ?? base?.Deadline ?? null;
  const due = deadlineMs(deadline);

  return {
    ...baseDto,
    elementId: args.elementId,
    title: ctx.redactor.title(a?.Title ?? base?.Title),
    course: baseDto?.course ?? ctx.redactor.title(a?.LearningObjectiveSettings?.CourseTitle),
    deadline,
    overdue: due !== undefined && due < ctx.now().getTime() && (base ? isOpen(base) : a?.AnswerId == null),
    homework: a?.IsHomework ?? base?.Homework ?? false,
    type: base ? taskType(base) : "assignment",
    detailsUnavailable: !a && !pageText,
    ...(a ? { detailsSource: "api" as const } : pageText ? { detailsSource: "page" as const, text: pageText } : {}),
    ...(a
      ? {
          text: ctx.redactor.text(a.Text || a.RawText, TEXT_LEN),
          mandatory: a.IsMandatory ?? false,
          submissionType: a.SubmissionType ?? null,
          completionMode: a.CompletionMode ?? null,
          lateSubmissionAllowed: a.IsSubmissionAfterDeadlineAllowed ?? false,
          hasAnswer: a.AnswerId != null,
          canSubmit: a.CanSubmitOrEditAnswer ?? false,
          files,
          ...(a.FilesInCloud?.length ? { cloudFilesCount: a.FilesInCloud.length } : {}),
        }
      : {}),
  };
}

export function registerTaskTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_tasks",
    {
      title: "List tasks",
      description:
        "Lists tasks/homework sorted by deadline (earliest first). Default: only open tasks, including overdue ones. Person names in texts are redacted.",
      inputSchema: listTasksInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_tasks", async (args: ListTasksArgs) => {
      const data = await listTasks(ctx, args);
      const overdue = data.tasks.filter((t) => t.overdue).length;
      return ok(`${data.total} tasks${overdue ? ` (${overdue} overdue on this page)` : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_get_task",
    {
      title: "Task details",
      description:
        'Details of a task: instructions (redacted, as text), deadline, submission type, whether it was submitted, attachments (fileRef → itslearning_download_file). For task types the API does not describe (e.g. polls, activities), `text` is taken from the task\'s web page (detailsSource: "page") and may include some interface labels; detailsUnavailable means no text could be obtained at all.',
      inputSchema: getTaskInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_get_task", async (args: { elementId: number }) => {
      const data = await getTask(ctx, args);
      return ok(`Task "${data.title}"${data.deadline ? `, due ${data.deadline}` : ""}.`, data);
    }),
  );
}
