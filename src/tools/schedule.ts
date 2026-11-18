/**
 * Calendar events and weekly/lesson plans (planner).
 *
 * UNVERIFIED AGAINST REAL DATA: the endpoints answer at a real instance (calendar: 200 with 0 events),
 * but no instance with calendar or planner content has been seen yet. Field names come from the public
 * API help pages (resource models CalendarEventV2, CalendarEvent, PlanPreview, PlanWithObjectivesAndElements).
 * The schemas contain no person objects; names inside free texts are redacted via the course dictionaries.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiCalendarEvent, ApiCourseCalendarEvent, ApiPlanInfo, ApiPlanPreview, Paged } from "../api/types";
import type { AppContext } from "../context";
import { formatRef } from "../files/refs";
import { log } from "../log";
import { isoDate } from "./news";
import { warmCourses } from "./people";
import { handler, ok } from "./result";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const TEXT_LEN = 2_000;
const PLAN_TEXT_LEN = 4_000;
const PLANSINFO_CHUNK = 20;

/** Start of the period (UTC day) and its end (exclusive), both as YYYY-MM-DD and ms. */
export function period(ctx: AppContext, from: string | undefined, days: number) {
  const base = from ? new Date(Date.parse(from)) : ctx.now();
  const fromDay = base.toISOString().slice(0, 10);
  const fromMs = Date.parse(`${fromDay}T00:00:00Z`);
  const toMs = fromMs + days * DAY_MS;
  return { fromDay, toDay: new Date(toMs).toISOString().slice(0, 10), fromMs, toMs };
}

const ms = (d?: string | null) => {
  const v = d ? Date.parse(d) : Number.NaN;
  return Number.isFinite(v) ? v : undefined;
};

/** True if [start, end] overlaps [fromMs, toMs). Entries without a parsable start are kept. */
function overlaps(start: string | null | undefined, end: string | null | undefined, fromMs: number, toMs: number) {
  const s = ms(start);
  const e = ms(end) ?? s;
  if (s === undefined) return true;
  return s < toMs && (e ?? s) >= fromMs;
}

async function allPages<T>(fetchPage: (pageIndex: number) => Promise<Paged<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchPage(page);
    const items = Array.isArray(res?.EntityArray) ? res.EntityArray : [];
    out.push(...items);
    if (items.length < PAGE_SIZE || out.length >= (res.Total ?? 0)) break;
  }
  return out;
}

// ---------- list_calendar ----------

export type CalendarEventDto = {
  eventId: number;
  title: string;
  start: string | null;
  end: string | null;
  /** Course | Project | Personal | Hierarchy (itslearning event type). */
  type: string;
  /** Title of the course/project/hierarchy the event belongs to. */
  location: string;
  courseId?: number;
  description?: string;
};

export const listCalendarInput = {
  courseId: z.number().int().positive().optional().describe("Only events of this course"),
  from: isoDate.optional().describe("Start date (ISO date, default: today)"),
  days: z.number().int().min(1).max(90).default(14).describe("Number of days from the start date"),
  limit: z.number().int().min(1).max(100).default(50),
};
type ListCalendarArgs = { courseId?: number; from?: string; days?: number; limit?: number };

type RawEvent = { e: ApiCalendarEvent | ApiCourseCalendarEvent; id: number; type: string; courseId?: number };

function toEventDto(ctx: AppContext, r: RawEvent): CalendarEventDto {
  const description = ctx.redactor.text(r.e.Description || r.e.ImportDescription, TEXT_LEN);
  return {
    eventId: r.id,
    title: ctx.redactor.title(r.e.EventTitle),
    start: r.e.FromDate ?? null,
    end: r.e.ToDate ?? null,
    type: r.type,
    location: ctx.redactor.title(r.e.LocationTitle),
    ...(r.courseId ? { courseId: r.courseId } : {}),
    ...(description ? { description } : {}),
  };
}

export async function listCalendar(ctx: AppContext, args: ListCalendarArgs) {
  const limit = args.limit ?? 50;
  const p = period(ctx, args.from, args.days ?? 14);
  const courseId = args.courseId;

  let raw: RawEvent[];
  if (courseId) {
    const list = await allPages((i) => ctx.it.courseCalendarEvents(courseId, p.fromDay, p.toDay, i, PAGE_SIZE));
    raw = list.map((e) => ({ e, id: e.Id, type: "Course", courseId: e.CourseId ?? courseId }));
  } else {
    // fromDate is required by the API (400 without it); there is no toDate → filter by end client-side
    const list = await allPages((i) => ctx.it.calendarEvents(p.fromDay, i, PAGE_SIZE));
    raw = list.map((e) => ({
      e,
      id: e.EventId,
      type: e.EventType ?? "Unknown",
      courseId: e.EventType === "Course" && e.LocationId ? e.LocationId : undefined,
    }));
  }

  const inRange = raw
    .filter((r) => overlaps(r.e.FromDate, r.e.ToDate, p.fromMs, p.toMs))
    .sort((a, b) => (ms(a.e.FromDate) ?? Infinity) - (ms(b.e.FromDate) ?? Infinity));
  const page = inRange.slice(0, limit);
  await warmCourses(
    ctx,
    page.map((r) => r.courseId),
  );
  return {
    from: p.fromDay,
    to: p.toDay,
    events: page.map((r) => toEventDto(ctx, r)),
    total: inRange.length,
    hasMore: inRange.length > limit,
  };
}

// ---------- list_plans ----------

export type PlanElementDto = { elementId: number; title: string; type: string; homework: boolean; fileRef?: string };

export type PlanDto = {
  planId: number;
  title: string;
  course: string;
  courseId?: number;
  topicId?: number;
  topic?: string;
  start: string | null;
  end: string | null;
  classHours?: number;
  description?: string;
  learningObjectives?: string[];
  elements?: PlanElementDto[];
};

export const listPlansInput = {
  courseId: z.number().int().positive().optional().describe("Only plans of this course (default: all current courses)"),
  from: isoDate.optional().describe("Start date (ISO date, default: today)"),
  days: z.number().int().min(1).max(90).default(14).describe("Number of days from the start date"),
  includeDetails: z.boolean().default(true).describe("Add topic, learning objectives and attached elements"),
  limit: z.number().int().min(1).max(100).default(30),
};
type ListPlansArgs = { courseId?: number; from?: string; days?: number; includeDetails?: boolean; limit?: number };

function toPlanDto(ctx: AppContext, p: ApiPlanPreview, courseId: number | undefined, info?: ApiPlanInfo): PlanDto {
  const description = ctx.redactor.text(p.PlanDescription || info?.PlanDescription, PLAN_TEXT_LEN);
  const objectives = (info?.LearningObjectives ?? []).map((o) => ctx.redactor.title(o.Title)).filter(Boolean);
  const elements = (info?.Elements ?? [])
    .filter((e) => typeof e?.Id === "number")
    .map((e) => ({
      elementId: e.Id,
      title: ctx.redactor.title(e.Title),
      type: e.Type ?? "Unknown",
      homework: e.IsMarkedAsHomework ?? false,
      ...(e.Type && e.Type !== "Folder" && e.Type !== "Unknown" ? { fileRef: formatRef({ kind: "element", elementId: e.Id }) } : {}),
    }));
  const topic = info?.PlanTopicName ? ctx.redactor.title(info.PlanTopicName) : "";
  return {
    planId: p.PlanId,
    title: ctx.redactor.title(p.PlanName || info?.PlanTitle),
    course: ctx.redactor.title(p.LocationTitle || info?.CourseName),
    ...(courseId ? { courseId } : {}),
    ...(p.TopicId ? { topicId: p.TopicId } : {}),
    ...(topic ? { topic } : {}),
    start: p.Start ?? info?.PlanStartDateTime ?? null,
    end: p.Stop ?? info?.PlanEndDateTime ?? null,
    ...(typeof p.ClassHours === "number" && p.ClassHours > 0 ? { classHours: p.ClassHours } : {}),
    ...(description ? { description } : {}),
    ...(objectives.length ? { learningObjectives: objectives } : {}),
    ...(elements.length ? { elements } : {}),
  };
}

/** Plan details in chunks; best effort (previews are returned without details on errors). */
async function plansInfo(ctx: AppContext, planIds: number[]): Promise<Map<number, ApiPlanInfo>> {
  const out = new Map<number, ApiPlanInfo>();
  for (let i = 0; i < planIds.length; i += PLANSINFO_CHUNK) {
    try {
      for (const info of await ctx.it.plansInfo(planIds.slice(i, i + PLANSINFO_CHUNK))) out.set(info.PlanId, info);
    } catch {
      log.warn("Plan details not available");
    }
  }
  return out;
}

export async function listPlans(ctx: AppContext, args: ListPlansArgs) {
  const limit = args.limit ?? 30;
  const p = period(ctx, args.from, args.days ?? 14);
  // The planner API wants a time part (UTC)
  const startDate = `${p.fromDay}T00:00:00`;
  const stopDate = `${p.toDay}T00:00:00`;

  const courseIds = args.courseId ? [args.courseId] : (await ctx.it.courses(false)).map((c) => c.CourseId);
  let unavailableCourses = 0;
  const perCourse = await Promise.all(
    courseIds.map(async (courseId) => {
      try {
        return (await ctx.it.coursePlans(courseId, startDate, stopDate)).map((plan) => ({ plan, courseId }));
      } catch (e) {
        if (args.courseId) throw e; // explicit course: report the error
        unavailableCourses++;
        return [];
      }
    }),
  );
  const seen = new Set<number>();
  const plans = perCourse
    .flat()
    .filter(({ plan }) => typeof plan?.PlanId === "number" && !seen.has(plan.PlanId) && seen.add(plan.PlanId))
    .filter(({ plan }) => overlaps(plan.Start, plan.Stop, p.fromMs, p.toMs))
    .sort((a, b) => (ms(a.plan.Start) ?? Infinity) - (ms(b.plan.Start) ?? Infinity) || (a.plan.Order ?? 0) - (b.plan.Order ?? 0));

  const page = plans.slice(0, limit);
  const infos =
    (args.includeDetails ?? true)
      ? await plansInfo(
          ctx,
          page.map((x) => x.plan.PlanId),
        )
      : new Map<number, ApiPlanInfo>();
  // Register course participants before redacting plan texts
  await warmCourses(
    ctx,
    page.map((x) => (x.plan.LocationType && !/course/i.test(x.plan.LocationType) ? undefined : x.courseId)),
  );
  return {
    from: p.fromDay,
    to: p.toDay,
    plans: page.map((x) => toPlanDto(ctx, x.plan, x.courseId, infos.get(x.plan.PlanId))),
    total: plans.length,
    hasMore: plans.length > limit,
    ...(unavailableCourses ? { unavailableCourses } : {}),
  };
}

export function registerScheduleTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_calendar",
    {
      title: "Calendar",
      description:
        "Calendar events (course events, personal events, …) in a period (default: the next 14 days), sorted by start – optionally for one course. Texts are redacted. May be empty if the school does not use the itslearning calendar; deadlines come from itslearning_list_tasks.",
      inputSchema: listCalendarInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_calendar", async (args: ListCalendarArgs) => {
      const data = await listCalendar(ctx, args);
      return ok(`${data.total} calendar events ${data.from} – ${data.to}${data.hasMore ? " (more available)" : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_list_plans",
    {
      title: "Weekly/lesson plans",
      description:
        "Plans from the course planner (weekly/lesson plans: topic, description, learning objectives, attached elements with fileRef → itslearning_download_file) that start or end in a period (default: the next 14 days) – for one course or all current courses. Texts are redacted. May be empty if the school does not use the planner.",
      inputSchema: listPlansInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_plans", async (args: ListPlansArgs) => {
      const data = await listPlans(ctx, args);
      return ok(`${data.total} plans ${data.from} – ${data.to}${data.hasMore ? " (more available)" : ""}.`, data);
    }),
  );
}
