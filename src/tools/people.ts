/**
 * Moves people from API responses into the registry – ALWAYS before redacting the texts
 * of the same response, so that their names are in the dictionary.
 */
import type { ApiMessage, ApiPublishedBy, ApiThread } from "../api/types";
import type { AppContext } from "../context";
import { parseRef } from "../files/refs";
import { log } from "../log";
import type { PersonRegistry, RoleHint } from "../redaction/registry";

export function registerPublishedBy(r: PersonRegistry, p: ApiPublishedBy | null | undefined, hint: RoleHint = "none") {
  if (!p) return;
  r.register(p.PersonId, { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName }, hint);
}

export function registerMessage(r: PersonRegistry, m: ApiMessage | null | undefined) {
  if (!m) return;
  r.register(m.CreatedBy, { fullName: m.CreatedByName, shortName: m.CreatedByShortName });
}

export function registerThread(r: PersonRegistry, t: ApiThread) {
  for (const p of t.Participants ?? []) r.registerParticipant(p);
  if (t.CreatedByTeacher && t.CreatedBy) r.register(t.CreatedBy, {}, "teacher");
  registerMessage(r, t.LastMessage);
  for (const m of t.Messages?.EntityArray ?? []) registerMessage(r, m);
}

// ---------- Course participants (name dictionary for course content) ----------

const warmed = new WeakMap<AppContext, Map<number, Promise<void>>>();

/**
 * Registers all participants of a course (once per process and course) so that their names are
 * recognized in course content (files, announcements, tasks) – even without any shared conversation.
 * Best effort: errors (e.g. missing permission) never abort anything.
 */
export function warmCourse(ctx: AppContext, courseId: number | null | undefined): Promise<void> {
  if (!courseId) return Promise.resolve();
  let map = warmed.get(ctx);
  if (!map) {
    map = new Map();
    warmed.set(ctx, map);
  }
  let p = map.get(courseId);
  if (!p) {
    p = ctx.it
      .courseParticipants(courseId)
      .then((list) => {
        for (const part of list) ctx.redactor.people.registerCourseParticipant(part);
      })
      .catch(() => {
        log.warn("Course participants not available – redaction relies on names already known");
      });
    map.set(courseId, p);
  }
  return p;
}

export async function warmCourses(ctx: AppContext, courseIds: Iterable<number | null | undefined>) {
  await Promise.all([...new Set(courseIds)].map((id) => warmCourse(ctx, id)));
}

/** Before a download: register everyone who might appear in the document. */
export async function warmForFileRef(ctx: AppContext, ref: string) {
  const src = parseRef(ref);
  try {
    switch (src.kind) {
      case "element":
        return await warmCourse(ctx, (await ctx.it.resource(src.elementId)).CourseId);
      case "bulletinImage":
        return await warmCourse(ctx, src.courseId);
      case "assignment": {
        const task = (await ctx.it.tasks()).find((t) => t.ElementId === src.elementId);
        return await warmCourse(ctx, task && /course/i.test(task.LocationType ?? "") ? task.LocationId : undefined);
      }
      case "message": {
        const list = await ctx.it.messageThreads(100);
        const t = list.Threads?.EntityArray?.find((x) => x.InstantMessageThreadId === src.threadId);
        if (t) registerThread(ctx.redactor.people, t);
        return;
      }
    }
  } catch {
    // the download itself reports the actual error, if any
  }
}
