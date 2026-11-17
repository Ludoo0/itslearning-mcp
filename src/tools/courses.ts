import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context";
import { log } from "../log";
import { handler, ok } from "./result";

export const listCoursesInput = {
  includeInactive: z.boolean().default(false).describe("Also include former/inactive courses"),
  starredOnly: z.boolean().default(false).describe("Only courses marked as favorite"),
};
type ListCoursesArgs = { includeInactive?: boolean; starredOnly?: boolean };

export type CourseDto = {
  courseId: number;
  title: string;
  code?: string;
  lastUpdated: string | null;
  newNotifications: number;
  newBulletins: number;
  starred: boolean;
  active: boolean;
};

export async function listCourses(ctx: AppContext, args: ListCoursesArgs) {
  const includeInactive = args.includeInactive ?? false;
  const [courses, activeCourses, starred] = await Promise.all([
    ctx.it.courses(includeInactive),
    includeInactive ? ctx.it.courses(false) : Promise.resolve(undefined),
    ctx.it.starredCourseIds().catch(() => {
      log.warn("Could not load favorite courses");
      return new Set<number>();
    }),
  ]);
  const activeIds = new Set((activeCourses ?? courses).map((c) => c.CourseId));

  let dtos: CourseDto[] = courses.map((c) => ({
    courseId: c.CourseId,
    title: ctx.redactor.title(c.Title),
    ...(c.CourseCode ? { code: ctx.redactor.title(c.CourseCode) } : {}),
    lastUpdated: c.LastUpdatedUtc ?? null,
    newNotifications: c.NewNotificationsCount ?? 0,
    newBulletins: c.NewBulletinsCount ?? 0,
    starred: starred.has(c.CourseId),
    active: activeIds.has(c.CourseId),
  }));
  if (args.starredOnly) dtos = dtos.filter((c) => c.starred);
  dtos.sort((a, b) => Number(b.starred) - Number(a.starred) || a.title.localeCompare(b.title));

  return { courses: dtos, total: dtos.length };
}

export function registerCourseTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_courses",
    {
      title: "List courses",
      description:
        "Lists the account's itslearning courses (default: current courses). Returns courseId for other tools and counters for new notifications/bulletins.",
      inputSchema: listCoursesInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_courses", async (args: ListCoursesArgs) => {
      const data = await listCourses(ctx, args);
      const fresh = data.courses.filter((c) => c.newNotifications + c.newBulletins > 0).length;
      return ok(`${data.total} courses${fresh ? `, ${fresh} with news` : ""}.`, data);
    }),
  );
}
