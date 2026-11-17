import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import { ToolError } from "../src/errors";
import { listCourses } from "../src/tools/courses";
import { getTask, listTasks } from "../src/tools/tasks";
import { fakeContext } from "./fixtures";

describe("itslearning_list_courses", () => {
  test("current courses, favorites first", async () => {
    const res = await listCourses(await fakeContext(), {});
    expect(res.courses.map((c) => c.courseId)).toEqual([12, 11]);
    expect(res.courses[0]).toMatchObject({ starred: true, active: true, newBulletins: 1 });
  });

  test("includeInactive marks former courses", async () => {
    const res = await listCourses(await fakeContext(), { includeInactive: true });
    expect(res.total).toBe(3);
    expect(res.courses.find((c) => c.courseId === 9)?.active).toBe(false);
  });

  test("a favorites error does not break the tool", async () => {
    const ctx = await fakeContext({ starredCourseIds: async () => Promise.reject(new Error("x")) });
    expect((await listCourses(ctx, {})).total).toBe(2);
  });
});

describe("itslearning_list_tasks", () => {
  test("open tasks sorted by deadline, no deadline last, overdue flagged", async () => {
    const res = await listTasks(await fakeContext(), {});
    expect(res.tasks.map((t) => t.elementId)).toEqual([7005, 7006, 7002, 7001, 7004]);
    expect(res.tasks[2]).toMatchObject({ elementId: 7002, overdue: true, type: "activity", courseId: 12 });
    expect(res.tasks[3]).toMatchObject({ elementId: 7001, overdue: false, homework: true, type: "assignment" });
  });

  test("free text is redacted", async () => {
    const res = await listTasks(await fakeContext(), {});
    expect(res.tasks.find((t) => t.elementId === 7002)!.descriptionPreview).toBe("Please, Me: read chapter 3");
  });

  test("status=all, filters and paging", async () => {
    const ctx = await fakeContext();
    expect((await listTasks(ctx, { status: "all" })).total).toBe(6);
    expect((await listTasks(ctx, { dueWithinDays: 3 })).tasks.map((t) => t.elementId)).toEqual([7005, 7006, 7002, 7001]);
    expect((await listTasks(ctx, { homeworkOnly: true })).tasks.map((t) => t.elementId)).toEqual([7001]);
    expect((await listTasks(ctx, { courseId: 11 })).tasks.map((t) => t.elementId)).toEqual([7006, 7001, 7004]);
    const page = await listTasks(ctx, { limit: 2, offset: 0 });
    expect(page).toMatchObject({ total: 5, hasMore: true });
  });

  test("activeCoursesOnly hides leftovers from inactive courses", async () => {
    const res = await listTasks(await fakeContext(), { activeCoursesOnly: true });
    expect(res.tasks.map((t) => t.elementId)).toEqual([7006, 7002, 7001, 7004]);
  });
});

describe("itslearning_get_task", () => {
  test("details with redacted instructions", async () => {
    const res = await getTask(await fakeContext(), { elementId: 7001 });
    expect(res).toMatchObject({
      title: "Fractions worksheet",
      detailsUnavailable: false,
      canSubmit: true,
      hasAnswer: false,
      files: [{ fileRef: "a_7001_1", name: "Fractions_Me.txt", kind: "file" }],
    });
    const text = (res as { text: string }).text;
    expect(text).toContain("Hello Me,");
    expect(text).toContain("[this sheet](https://example.org/sheet.pdf)");
    expect(text).toContain("[email]");
    expect(text).toContain("[phone]");
    expect(text).not.toMatch(/Jonas|Beispielmann|SECRET123|filerepository|demo\.itslearning/);
  });

  test("403 (CustomActivity) → instructions from the task page, redacted, without page chrome", async () => {
    const ctx = await fakeContext();
    const res = (await getTask(ctx, { elementId: 7002 })) as Record<string, unknown>;
    expect(res).toMatchObject({ elementId: 7002, type: "activity", detailsUnavailable: false, detailsSource: "page" });
    const text = String(res.text);
    const mia = ctx.redactor.people.resolve(3001).display;
    expect(text).toContain("Please read chapter 3 by Friday");
    expect(text).toContain(`Questions to Teacher Lindqvist ([email]) or ask ${mia}.`);
    expect(text).toContain("[encoded data removed]");
    // header/nav/footer are page chrome, not task content
    expect(text).not.toMatch(/Logged in as|Courses|Imprint/);
    expect(text).not.toMatch(/Jonas|Beispielmann|Sabine|Sonnenfeld|PersonId|school\.example|itslearning\.com/);
  });

  test("task page not available → base data with detailsUnavailable, no error", async () => {
    const ctx = await fakeContext({ ssoUrl: async () => Promise.reject(new ToolError("UPSTREAM_ERROR", "down")) });
    const res = await getTask(ctx, { elementId: 7002 });
    expect(res).toMatchObject({ elementId: 7002, detailsUnavailable: true, type: "activity" });
    expect((res as Record<string, unknown>).text).toBeUndefined();
  });

  test("assignment API available → detailsSource api, no page request", async () => {
    const res = await getTask(await fakeContext(), { elementId: 7001 });
    expect(res).toMatchObject({ detailsUnavailable: false, detailsSource: "api" });
  });

  test("unknown task → NOT_FOUND / FORBIDDEN", async () => {
    const err = (await getTask(await fakeContext(), { elementId: 999 }).catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
  });
});

describe("MCP protocol (in-memory)", () => {
  async function connect() {
    const ctx = await fakeContext();
    const server = createServer(ctx);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  test("tools are registered and annotated read-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "itslearning_download_file",
      "itslearning_get_message_thread",
      "itslearning_get_task",
      "itslearning_list_bulletins",
      "itslearning_list_course_files",
      "itslearning_list_courses",
      "itslearning_list_message_threads",
      "itslearning_list_news",
      "itslearning_list_tasks",
      "itslearning_overview",
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    // Tool descriptions are English
    expect(tools.map((t) => t.description).join(" ")).not.toMatch(/[äöüß]|Aufgabe|Datei/);
  });

  test("a call returns structuredContent and text", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_list_tasks", arguments: { limit: 1 } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { total: number }).total).toBe(5);
    expect(JSON.stringify(res.content)).toContain("5 tasks");
  });

  test("errors come back as isError with a code", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_get_task", arguments: { elementId: 999 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/FORBIDDEN|NOT_FOUND/);
  });

  test("invalid input is rejected", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_list_tasks", arguments: { limit: 1000 } }).catch((e) => ({ isError: true, e }));
    expect(res.isError).toBe(true);
  });
});
