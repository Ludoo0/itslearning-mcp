import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context";
import { log } from "../log";
import { childCourses, childIdInput, resolveChildId } from "./children";
import { handler, ok } from "./result";

export const listCoursesInput = {
  includeInactive: z.boolean().default(false).describe("Also include former/inactive courses"),
  starredOnly: z.boolean().default(false).describe("Only courses marked as favorite"),
  childId: childIdInput,
};
type ListCoursesArgs = { includeInactive?: boolean; starredOnly?: boolean; childId?: string };

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

/**
 * Courses of a child (parent accounts) – EXPERIMENTAL, the child endpoint is not verified against a real
 * parent account. The API offers no counters, favorites or former courses for children.
 */
async function listChildCourses(ctx: AppContext, childId: number, args: ListCoursesArgs) {
  const courses = await childCourses(ctx, childId);
  let dtos: CourseDto[] = courses.map((c) => ({
    courseId: c.CourseId,
    title: ctx.redactor.title(c.Title),
    ...(c.CourseCode ? { code: ctx.redactor.title(c.CourseCode) } : {}),
    lastUpdated: null,
    newNotifications: 0,
    newBulletins: 0,
    starred: false,
    active: true,
  }));
  if (args.starredOnly) dtos = [];
  dtos.sort((a, b) => a.title.localeCompare(b.title));
  return { courses: dtos, total: dtos.length };
}

export async function listCourses(ctx: AppContext, args: ListCoursesArgs) {
  const childId = await resolveChildId(ctx, args.childId);
  if (childId !== undefined) return listChildCourses(ctx, childId, args);
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
        "Lists the account's itslearning courses (default: current courses). Returns courseId for other tools and counters for new notifications/bulletins. Parent accounts (EXPERIMENTAL, unverified): courses of the child given by childId (default: the only child), without counters/favorites.",
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
