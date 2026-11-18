import { describe, expect, test } from "bun:test";
import { ToolError } from "../src/errors";
import { listCalendar, listPlans } from "../src/tools/schedule";
import { fakeContext, P_STUDENT, paged } from "./fixtures";

describe("itslearning_list_calendar", () => {
  test("events in the period sorted by start, fields mapped, out-of-range events dropped", async () => {
    const ctx = await fakeContext();
    const res = await listCalendar(ctx, {});
    expect(res).toMatchObject({ from: "2026-11-16", to: "2026-11-30", total: 2, hasMore: false });
    expect(res.events.map((e) => e.eventId)).toEqual([9101, 9102]);
    expect(res.events[0]).toMatchObject({
      title: "Test: fractions",
      start: "2026-11-17T08:00:00Z",
      end: "2026-11-17T09:30:00Z",
      type: "Course",
      location: "Math 8b",
      courseId: 11,
    });
    expect(res.events[1]).toMatchObject({ type: "Personal", location: "" });
    expect(res.events[1]).not.toHaveProperty("courseId");
  });

  test("names, e-mails and internal links in descriptions are redacted", async () => {
    const ctx = await fakeContext();
    const res = await listCalendar(ctx, {});
    const mia = ctx.redactor.people.resolve(P_STUDENT.PersonId).display;
    expect(res.events[0]!.description).toBe("Bring a calculator, Me. Questions to Teacher Lindqvist ([email]), see course");
    expect(res.events[1]!.description).toBe(`Meeting with ${mia}`); // ImportDescription as fallback
  });

  test("fromDate is always sent (date only); from/days define the period", async () => {
    const seen: string[] = [];
    const ctx = await fakeContext({
      calendarEvents: async (fromDate, i, s) => {
        seen.push(fromDate);
        return paged([], i, s);
      },
    });
    await listCalendar(ctx, {});
    await listCalendar(ctx, { from: "2026-12-01T10:30:00Z", days: 30 });
    expect(seen).toEqual(["2026-11-16", "2026-12-01"]);

    const all = await listCalendar(await fakeContext(), { from: "2026-11-18", days: 90 });
    expect(all.events.map((e) => e.eventId)).toEqual([9102, 9103]);
    expect(all.to).toBe("2027-02-16");
  });

  test("course mode uses the course endpoint with fromDate and toDate", async () => {
    const seen: unknown[] = [];
    const ctx = await fakeContext();
    const orig = ctx.it.courseCalendarEvents;
    ctx.it.courseCalendarEvents = (courseId, from, to, i, s) => {
      seen.push([courseId, from, to]);
      return orig(courseId, from, to, i, s);
    };
    const res = await listCalendar(ctx, { courseId: 11, days: 7 });
    expect(seen).toEqual([[11, "2026-11-16", "2026-11-23"]]);
    expect(res.events).toEqual([
      {
        eventId: 9101,
        title: "Test: fractions",
        start: "2026-11-17T08:00:00Z",
        end: "2026-11-17T09:30:00Z",
        type: "Course",
        location: "Math 8b",
        courseId: 11,
        description: "Bring a calculator.",
      },
    ]);
  });

  test("limit and empty calendar", async () => {
    const limited = await listCalendar(await fakeContext(), { limit: 1 });
    expect(limited).toMatchObject({ total: 2, hasMore: true });
    expect(limited.events).toHaveLength(1);
    const empty = await listCalendar(await fakeContext({ calendarEvents: async (_f, i, s) => paged([], i, s) }), {});
    expect(empty).toMatchObject({ events: [], total: 0, hasMore: false });
  });
});

describe("itslearning_list_plans", () => {
  test("plans of all current courses in the period, with details and fileRefs", async () => {
    const ctx = await fakeContext();
    const res = await listPlans(ctx, {});
    expect(res).toMatchObject({ from: "2026-11-16", to: "2026-11-30", total: 2, hasMore: false });
    expect(res.plans.map((p) => p.planId)).toEqual([9201, 9203]); // dated first, undated last; 9202 out of range
    const [week, reading] = res.plans;
    expect(week).toMatchObject({
      title: "Week 47: fractions",
      course: "Math 8b",
      courseId: 11,
      topicId: 33,
      topic: "Fractions",
      start: "2026-11-16T00:00:00Z",
      end: "2026-11-20T00:00:00Z",
      classHours: 4,
      learningObjectives: ["Add fractions"],
      elements: [
        { elementId: 7201, title: "Worksheet week 1", type: "LearningToolElement", homework: true, fileRef: "e_7201" },
        { elementId: 7300, title: "Worksheets", type: "Folder", homework: false },
      ],
    });
    expect(JSON.stringify(res)).not.toMatch(/PLANSECRET|Planner\.aspx|itslearning\.com/);
    expect(reading).toEqual({ planId: 9203, title: "Reading project", course: "English 8b", courseId: 12, start: null, end: null });
  });

  test("plan description is redacted", async () => {
    const ctx = await fakeContext();
    const res = await listPlans(ctx, { courseId: 11 });
    const mia = ctx.redactor.people.resolve(P_STUDENT.PersonId).display;
    expect(res.plans[0]!.description).toBe(`Work with ${mia} on page 12. Contact: [email]`);
  });

  test("start/stop dates are sent with a time part; includeDetails=false skips plansinfo", async () => {
    const seen: unknown[] = [];
    let infoCalls = 0;
    const ctx = await fakeContext({
      coursePlans: async (courseId, start, stop) => {
        seen.push([courseId, start, stop]);
        return [];
      },
      plansInfo: async () => {
        infoCalls++;
        return [];
      },
    });
    const res = await listPlans(ctx, { courseId: 12, from: "2026-11-23", days: 7, includeDetails: false });
    expect(seen).toEqual([[12, "2026-11-23T00:00:00", "2026-11-30T00:00:00"]]);
    expect(infoCalls).toBe(0);
    expect(res).toMatchObject({ plans: [], total: 0, hasMore: false });
  });

  test("errors: plansinfo failure keeps previews; failing courses are counted, explicit course reports the error", async () => {
    const noInfo = await listPlans(await fakeContext({ plansInfo: async () => Promise.reject(new Error("x")) }), { courseId: 11 });
    expect(noInfo.plans[0]).toMatchObject({ planId: 9201, title: "Week 47: fractions" });
    expect(noInfo.plans[0]).not.toHaveProperty("elements");

    const forbid = async (courseId: number) => {
      if (courseId === 12) throw new ToolError("FORBIDDEN", "No access to this element.", 403);
      return [];
    };
    const partial = await listPlans(await fakeContext({ coursePlans: forbid }), {});
    expect(partial).toMatchObject({ plans: [], unavailableCourses: 1 });
    await expect(listPlans(await fakeContext({ coursePlans: forbid }), { courseId: 12 })).rejects.toThrow(ToolError);
  });
});
