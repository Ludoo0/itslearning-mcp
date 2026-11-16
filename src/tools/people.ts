/**
 * Übernimmt Personen aus API-Antworten in die Registry – IMMER vor dem Schwärzen der Texte
 * derselben Antwort, damit deren Namen im Wörterbuch stehen.
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

// ---------- Kurs-Teilnehmer:innen (Namens-Wörterbuch für Kurs-Inhalte) ----------

const warmed = new WeakMap<AppContext, Map<number, Promise<void>>>();

/**
 * Registriert alle Teilnehmer:innen eines Kurses (einmal pro Prozess und Kurs), damit ihre Namen in
 * Kurs-Inhalten (Dateien, Ankündigungen, Aufgaben) erkannt werden – auch wenn es nie eine gemeinsame
 * Unterhaltung gab. Best effort: Fehler (z. B. keine Berechtigung) brechen nichts ab.
 */
export function warmCourse(ctx: AppContext, courseId: number | null | undefined): Promise<void> {
  if (!courseId) return Promise.resolve();
  let map = warmed.get(ctx);
  if (!map) warmed.set(ctx, (map = new Map()));
  let p = map.get(courseId);
  if (!p) {
    p = ctx.it
      .courseParticipants(courseId)
      .then((list) => {
        for (const part of list) ctx.redactor.people.registerCourseParticipant(part);
      })
      .catch(() => {
        log.warn("Kurs-Teilnehmer:innen nicht abrufbar – Schwärzung stützt sich auf bereits bekannte Namen");
      });
    map.set(courseId, p);
  }
  return p;
}

export async function warmCourses(ctx: AppContext, courseIds: Iterable<number | null | undefined>) {
  await Promise.all([...new Set(courseIds)].map((id) => warmCourse(ctx, id)));
}

/** Vor dem Download: alle Personen registrieren, die im Dokument stehen könnten. */
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
    // Download selbst meldet ggf. den eigentlichen Fehler
  }
}
