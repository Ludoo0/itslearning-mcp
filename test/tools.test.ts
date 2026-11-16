import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import { ToolError } from "../src/errors";
import { listCourses } from "../src/tools/courses";
import { getTask, listTasks } from "../src/tools/tasks";
import { fakeContext } from "./fixtures";

describe("itslearning_list_courses", () => {
  test("aktuelle Kurse, Favoriten zuerst", async () => {
    const res = await listCourses(await fakeContext(), {});
    expect(res.courses.map((c) => c.courseId)).toEqual([12, 11]);
    expect(res.courses[0]).toMatchObject({ starred: true, active: true, newBulletins: 1 });
  });

  test("includeInactive markiert ehemalige Kurse", async () => {
    const res = await listCourses(await fakeContext(), { includeInactive: true });
    expect(res.total).toBe(3);
    expect(res.courses.find((c) => c.courseId === 9)?.active).toBe(false);
  });

  test("Favoriten-Fehler bricht das Tool nicht ab", async () => {
    const ctx = await fakeContext({ starredCourseIds: async () => Promise.reject(new Error("x")) });
    expect((await listCourses(ctx, {})).total).toBe(2);
  });
});

describe("itslearning_list_tasks", () => {
  test("offen, nach Frist sortiert, ohne Frist zuletzt, überfällig markiert", async () => {
    const res = await listTasks(await fakeContext(), {});
    expect(res.tasks.map((t) => t.elementId)).toEqual([7002, 7001, 7004]);
    expect(res.tasks[0]).toMatchObject({ overdue: true, type: "activity", courseId: 12 });
    expect(res.tasks[1]).toMatchObject({ overdue: false, homework: true, type: "assignment" });
  });

  test("Freitext ist geschwärzt", async () => {
    const res = await listTasks(await fakeContext(), {});
    expect(res.tasks[0]!.descriptionPreview).toBe("Bitte an Ich: Kapitel 3 lesen");
  });

  test("status=all, Filter und Paging", async () => {
    const ctx = await fakeContext();
    expect((await listTasks(ctx, { status: "all" })).total).toBe(4);
    expect((await listTasks(ctx, { dueWithinDays: 3 })).tasks.map((t) => t.elementId)).toEqual([7002, 7001]);
    expect((await listTasks(ctx, { homeworkOnly: true })).tasks.map((t) => t.elementId)).toEqual([7001]);
    expect((await listTasks(ctx, { courseId: 11 })).tasks.map((t) => t.elementId)).toEqual([7001, 7004]);
    const page = await listTasks(ctx, { limit: 2, offset: 0 });
    expect(page).toMatchObject({ total: 3, hasMore: true });
  });
});

describe("itslearning_get_task", () => {
  test("Details mit geschwärzter Aufgabenstellung", async () => {
    const res = await getTask(await fakeContext(), { elementId: 7001 });
    expect(res).toMatchObject({ title: "Arbeitsblatt Brüche", detailsUnavailable: false, attachmentCount: 1, canSubmit: true, hasAnswer: false });
    const text = (res as { text: string }).text;
    expect(text).toContain("Hallo Ich,");
    expect(text).toContain("[dieses Blatt](https://example.org/blatt.pdf)");
    expect(text).toContain("[E-Mail]");
    expect(text).toContain("[Telefon]");
    expect(text).not.toMatch(/Jonas|Beispielmann|SECRET123|filerepository|demo\.itslearning/);
  });

  test("403 (CustomActivity) → Basisdaten mit detailsUnavailable", async () => {
    const res = await getTask(await fakeContext(), { elementId: 7002 });
    expect(res).toMatchObject({ elementId: 7002, detailsUnavailable: true, type: "activity" });
  });

  test("unbekannte Aufgabe → NOT_FOUND / FORBIDDEN", async () => {
    const err = (await getTask(await fakeContext(), { elementId: 999 }).catch((e) => e)) as ToolError;
    expect(err).toBeInstanceOf(ToolError);
  });
});

describe("MCP-Protokoll (in-memory)", () => {
  async function connect() {
    const ctx = await fakeContext();
    const server = createServer(ctx);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  test("Tools sind registriert und read-only annotiert", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["itslearning_get_task", "itslearning_list_courses", "itslearning_list_tasks"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  test("Aufruf liefert structuredContent und Text", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_list_tasks", arguments: { limit: 1 } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { total: number }).total).toBe(3);
    expect(JSON.stringify(res.content)).toContain("3 Aufgaben");
  });

  test("Fehler kommen als isError mit Code", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_get_task", arguments: { elementId: 999 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/FORBIDDEN|NOT_FOUND/);
  });

  test("ungültige Eingabe wird abgelehnt", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "itslearning_list_tasks", arguments: { limit: 1000 } }).catch((e) => ({ isError: true, e }));
    expect(res.isError).toBe(true);
  });
});
