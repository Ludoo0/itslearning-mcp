import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiAssignment, ApiTask } from "../api/types";
import type { AppContext } from "../context";
import { ToolError } from "../errors";
import { type FileRefDto, formatRef } from "../files/refs";
import { redactFileName } from "./files";
import { warmCourses } from "./people";
import { handler, ok } from "./result";

/** Status-Werte, die als erledigt gelten (gesehen bisher nur "NotStarted"; weitere Werte ⏳). */
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

const courseIdOf = (t: ApiTask) => (t.LocationId && /course/i.test(t.LocationType ?? "") ? t.LocationId : undefined);
const isOpen = (t: ApiTask) => !DONE_RE.test(t.Status ?? "");
const deadlineMs = (d?: string | null) => {
  if (!d) return undefined;
  const ms = Date.parse(d);
  return Number.isFinite(ms) ? ms : undefined;
};

export function toTaskDto(ctx: AppContext, t: ApiTask): TaskDto {
  const due = deadlineMs(t.Deadline);
  const preview = ctx.redactor.text(t.Description, PREVIEW_LEN);
  return {
    taskId: t.TaskId,
    elementId: t.ElementId,
    title: ctx.redactor.title(t.Title),
    course: ctx.redactor.title(t.LocationTitle),
    ...(t.LocationId && /course/i.test(t.LocationType ?? "") ? { courseId: t.LocationId } : {}),
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
  courseId: z.number().int().positive().optional().describe("Nur Aufgaben dieses Kurses"),
  status: z.enum(["open", "all"]).default("open").describe("open = noch nicht erledigt (inkl. überfällig)"),
  dueWithinDays: z.number().int().min(0).max(365).optional().describe("Nur Aufgaben mit Frist in den nächsten N Tagen (inkl. überfälliger)"),
  homeworkOnly: z.boolean().default(false).describe("Nur als Hausaufgabe markierte Aufgaben"),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
};
type ListTasksArgs = {
  courseId?: number;
  status?: "open" | "all";
  dueWithinDays?: number;
  homeworkOnly?: boolean;
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
 * Anhänge einer Aufgabe → fileRefs. Die genaue Form der Datei-Objekte ist noch nicht verifiziert (⏳),
 * daher tolerant: FileId/Id als ID, FileName/Name/Title als Name.
 */
export function assignmentFiles(ctx: AppContext, elementId: number, a: ApiAssignment): FileRefDto[] {
  const raw = [...(Array.isArray(a.Files) ? a.Files : []), ...(a.TemplateFile ? [a.TemplateFile] : [])];
  const out: FileRefDto[] = [];
  raw.forEach((f, i) => {
    if (!f || typeof f !== "object") return;
    const o = f as Record<string, unknown>;
    const fileId = typeof o.FileId === "number" ? o.FileId : typeof o.Id === "number" ? o.Id : undefined;
    if (fileId === undefined) return;
    const name = [o.FileName, o.Name, o.Title].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? `Anhang ${i + 1}`;
    out.push({ fileRef: formatRef({ kind: "assignment", elementId, fileId }), name: redactFileName(ctx, name), kind: "file" });
  });
  return out;
}

export const getTaskInput = {
  elementId: z.number().int().positive().describe("elementId aus itslearning_list_tasks"),
};

export async function getTask(ctx: AppContext, args: { elementId: number }) {
  const base = (await ctx.it.tasks()).find((t) => t.ElementId === args.elementId);
  if (base) await warmCourses(ctx, [courseIdOf(base)]);

  let a: Awaited<ReturnType<AppContext["it"]["assignment"]>> | undefined;
  try {
    a = await ctx.it.assignment(args.elementId);
  } catch (e) {
    // CustomActivity u. ä.: Details nicht über die API lesbar → Basisdaten aus der Aufgabenliste
    if (!(e instanceof ToolError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND") && base)) throw e;
  }
  if (!a && !base) throw new ToolError("NOT_FOUND", "Aufgabe nicht gefunden.");

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
    detailsUnavailable: !a,
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
      title: "Aufgaben auflisten",
      description:
        "Listet Aufgaben/Hausaufgaben, sortiert nach Frist (früheste zuerst). Standard: nur offene Aufgaben inkl. überfälliger. Personennamen in Texten sind geschwärzt.",
      inputSchema: listTasksInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_tasks", async (args: ListTasksArgs) => {
      const data = await listTasks(ctx, args);
      const overdue = data.tasks.filter((t) => t.overdue).length;
      return ok(`${data.total} Aufgaben${overdue ? ` (davon ${overdue} überfällig auf dieser Seite)` : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_get_task",
    {
      title: "Aufgabe im Detail",
      description:
        "Details einer Aufgabe: Aufgabenstellung (geschwärzt, als Text), Frist, Abgabe-Art, ob schon abgegeben, Anhänge (fileRef → itslearning_download_file). Bei manchen Aufgabentypen sind keine Details verfügbar (detailsUnavailable).",
      inputSchema: getTaskInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_get_task", async (args: { elementId: number }) => {
      const data = await getTask(ctx, args);
      return ok(`Aufgabe „${data.title}“${data.deadline ? `, fällig ${data.deadline}` : ""}.`, data);
    }),
  );
}
