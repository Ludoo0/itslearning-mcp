/** Parent accounts (experimental support) – fictional data only. */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import type { AppContext } from "../src/context";
import { ToolError } from "../src/errors";
import { PersonRegistry } from "../src/redaction/registry";
import { TeacherDirectory } from "../src/redaction/teachers";
import { listChildren } from "../src/tools/children";
import { listCourses } from "../src/tools/courses";
import { overview } from "../src/tools/overview";
import { listTasks } from "../src/tools/tasks";
import { fakeContext, P_CHILD, P_CHILD_TEACHER, P_CHILD2, PARENT_FORBIDDEN_NAMES, parentOverrides } from "./fixtures";

const parent = (children = [P_CHILD], opts: Parameters<typeof fakeContext>[1] = {}) => fakeContext(parentOverrides(children), opts);
/** Pseudonymous childId as emitted by itslearning_list_children (same fixed test secret as fakeContext). */
const keyRegistry = new PersonRegistry({
  secret: "test-secret-not-for-production",
  baseUrl: "https://demo.itslearning.com",
  teachers: new TeacherDirectory(null),
  redactTeachers: false,
  teacherRoleTitles: [],
});
const key = (id: number) => keyRegistry.personKey(id);
const childDisplay = (ctx: AppContext, id = P_CHILD.PersonId) => ctx.redactor.people.resolve(id).display;

describe("itslearning_list_children", () => {
  test("children as pseudonyms with childId, never real names or the school", async () => {
    const ctx = await parent([P_CHILD, P_CHILD2]);
    const res = await listChildren(ctx);
    expect(res).toMatchObject({ parentAccount: true, total: 2 });
    expect(res.children.map((c) => c.childId)).toEqual([key(5001), key(5002)]);
    // the real PersonIds are never emitted
    expect(JSON.stringify(res)).not.toMatch(/5001|5002/);
    for (const c of res.children) expect(c.childId).toMatch(/^[0-9A-F]{8}$/);
    for (const c of res.children) {
      expect(c.role).toBe("child");
      expect(c.display).toMatch(/^Child-[0-9A-F]{4,6}$/);
    }
    expect(JSON.stringify(res)).not.toMatch(/Lena|Felix|Beispielmann|School/);
  });

  test("German label", async () => {
    const res = await listChildren(await parent([P_CHILD], { language: "de" }));
    expect(res.children[0]!.display).toMatch(/^Kind-[0-9A-F]{4,6}$/);
  });

  test("children/v1 failing → children from person/v1", async () => {
    const ctx = await fakeContext({ ...parentOverrides(), children: async () => Promise.reject(new ToolError("NOT_FOUND", "x", 404)) });
    expect((await listChildren(ctx)).children.map((c) => c.childId)).toEqual([key(5001)]);
  });

  test("student account: empty list, child endpoint never called", async () => {
    let called = 0;
    const ctx = await fakeContext({
      children: async () => {
        called++;
        return [];
      },
    });
    expect(await listChildren(ctx)).toEqual({ parentAccount: false, children: [], total: 0 });
    expect(called).toBe(0);
  });
});

describe("child tasks and courses", () => {
  test("the only child is the default; child names in texts become the pseudonym", async () => {
    const ctx = await parent();
    const res = await listTasks(ctx, {});
    expect(res.tasks.map((t) => t.elementId)).toEqual([7902, 7901]);
    const lena = childDisplay(ctx);
    const preview = res.tasks.find((t) => t.elementId === 7901)!.descriptionPreview!;
    expect(preview).toBe(`${lena}, please practice with Teacher Haldorsen's sheet. ${lena}: bring the recorder.`);
    expect(res.tasks[0]).toMatchObject({ elementId: 7902, overdue: true, courseId: 22 });
  });

  test("explicit childId, course filter and activeCoursesOnly use the child endpoints", async () => {
    const ctx = await parent([P_CHILD, P_CHILD2]);
    expect((await listTasks(ctx, { childId: key(5002) })).tasks.map((t) => t.elementId)).toEqual([7911]);
    expect((await listTasks(ctx, { childId: key(5001), courseId: 21 })).tasks.map((t) => t.elementId)).toEqual([7901]);
    expect((await listTasks(ctx, { childId: key(5001), activeCoursesOnly: true })).total).toBe(2);
  });

  test("several children without childId / unknown childId → INVALID_INPUT", async () => {
    const ctx = await parent([P_CHILD, P_CHILD2]);
    const e1 = (await listTasks(ctx, {}).catch((e) => e)) as ToolError;
    expect(e1).toBeInstanceOf(ToolError);
    expect(e1.code).toBe("INVALID_INPUT");
    const e2 = (await listCourses(ctx, { childId: "FFFFFFFF" }).catch((e) => e)) as ToolError;
    expect(e2.code).toBe("INVALID_INPUT");
  });

  test("child courses; their teachers are registered as teachers", async () => {
    const ctx = await parent();
    const res = await listCourses(ctx, {});
    expect(res.courses.map((c) => c.courseId)).toEqual([22, 21]);
    expect(res.courses[0]).toMatchObject({ title: "Art 5a", active: true, starred: false, newNotifications: 0 });
    expect(ctx.redactor.people.role(P_CHILD_TEACHER.PersonId)).toBe("teacher");
    expect((await listCourses(ctx, { childId: key(5001), starredOnly: true })).total).toBe(0);
  });

  test("overview with the child's tasks", async () => {
    const res = await overview(await parent(), { days: 7 });
    expect(res.overdue.map((t) => t.elementId)).toEqual([7902]);
    expect(res.dueSoon.map((t) => t.elementId)).toEqual([7901]);
  });

  test("student account: childId is ignored, own tasks and courses", async () => {
    const ctx = await fakeContext();
    expect((await listTasks(ctx, { childId: key(5001) })).tasks.map((t) => t.elementId)).toEqual([7005, 7006, 7002, 7001, 7004]);
    expect((await listCourses(ctx, { childId: key(5001) })).courses.map((c) => c.courseId)).toEqual([12, 11]);
  });
});

describe("Leak test via the MCP protocol (parent account)", () => {
  test("no child, parent or teacher first names, no school in any output", async () => {
    const ctx = await parent();
    const server = createServer(ctx);
    const client = new Client({ name: "leak-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const calls: [string, Record<string, unknown>][] = [
      ["itslearning_list_children", {}],
      ["itslearning_overview", {}],
      ["itslearning_list_courses", {}],
      ["itslearning_list_tasks", { status: "all", childId: key(5001) }],
    ];
    const outputs: string[] = [];
    for (const [name, args] of calls) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, `${name} should not fail`).toBeFalsy();
      outputs.push(JSON.stringify(res));
    }
    const all = outputs.join("\n");
    for (const n of PARENT_FORBIDDEN_NAMES) expect(all, `"${n}" must not appear`).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(all).not.toMatch(/Fictional School|PersonId/);
    expect(all).toContain(childDisplay(ctx));
    expect(all).toContain("Teacher Haldorsen");
  });
});
