import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import { listBulletins } from "../src/tools/bulletins";
import { getThread, listThreads } from "../src/tools/messages";
import { listNews } from "../src/tools/news";
import { overview } from "../src/tools/overview";
import { FORBIDDEN_NAMES, fakeContext, P_STUDENT, P_TEACHER, P_UNKNOWN } from "./fixtures";

describe("itslearning_list_news", () => {
  test("newest first, since filter, kinds, authors and redacted texts", async () => {
    const ctx = await fakeContext();
    const res = await listNews(ctx, { since: "2026-11-09" });
    expect(res.items.map((i) => i.id)).toEqual([8001, 8002]);
    const [bulletin, element] = res.items;
    expect(bulletin).toMatchObject({
      kind: "bulletin",
      bulletinId: 6001,
      images: [{ fileRef: "i_12_6001_0" }],
      courseId: 12,
      author: { display: "Teacher Lindqvist", role: "teacher" },
    });
    expect(bulletin!.text).toBe("Dear class, please hand in to Teacher Lindqvist. Questions: [email]");
    expect(element).toMatchObject({ kind: "element", elementId: 7001, fileRef: "e_7001", author: { role: "unknown" } });
    expect(element!.text).toMatch(/^New task: Fractions worksheet \(by Person-[0-9A-F]{4}\)$/);
  });

  test("course filter", async () => {
    const res = await listNews(await fakeContext(), { courseId: 11 });
    expect(res.items.map((i) => i.id)).toEqual([8002, 8003]);
  });
});

describe("itslearning_list_bulletins", () => {
  test("resources, links only if shareable, paging", async () => {
    const res = await listBulletins(await fakeContext(), { courseId: 12 });
    expect(res.total).toBe(2);
    const [b1, b2] = res.bulletins;
    expect(b1).toMatchObject({
      pinned: true,
      link: "https://example.org/info",
      images: [{ fileRef: "i_12_6001_0", name: "Image 1", kind: "image" }],
      commentsCount: 2,
    });
    expect(b1!.resources).toEqual([{ elementId: 7101, title: "Reading list", type: "LearningToolElement", fileRef: "e_7101" }]);
    expect(b2!.link).toBeUndefined();
    expect(b2!.text).toBe("See [itslearning link]");
    expect(b2!.author?.role).toBe("teacher"); // bulletin author (weak hint)
  });
});

describe("itslearning_list_message_threads", () => {
  test("titles, participants, unread status, no misleading total", async () => {
    const ctx = await fakeContext();
    const res = await listThreads(ctx, {});
    const [t1, t2, t3, t4] = res.threads;
    const mia = ctx.redactor.people.resolve(P_STUDENT.PersonId).display;

    expect(res).not.toHaveProperty("total"); // itslearning reports Total = 0
    expect(t1).toMatchObject({ threadId: 9001, title: "Teacher Lindqvist", unread: true, participantsCount: 2 });
    expect(t1!.lastMessage?.preview).toBe(`Hi Me, ${mia} has your notebook.`);
    expect(t2).toMatchObject({ title: `Project with ${mia}`, unread: false });
    expect(t2!.participants.map((p) => p.display)).toContain("Teacher Brandauer"); // via CreatedByTeacher
    expect(t3).toMatchObject({ title: "English 8b", unread: true, participantsCount: 7 });
    expect(t3!.participants).toEqual([{ display: "Teacher Lindqvist", role: "teacher" }]); // large group: teachers only
    expect(t4).toMatchObject({ threadId: 9004, title: "Group (6 participants) with Teacher Lindqvist" }); // group title
  });

  test("filters unreadOnly and type", async () => {
    const ctx = await fakeContext();
    expect((await listThreads(ctx, { unreadOnly: true })).threads.map((t) => t.threadId)).toEqual([9001, 9003]);
    expect((await listThreads(ctx, { type: "Group" })).threads.map((t) => t.threadId)).toEqual([9002, 9004]);
  });

  test("German labels (REDACTION_LANGUAGE=de)", async () => {
    const ctx = await fakeContext({}, { language: "de" });
    const res = await listThreads(ctx, {});
    expect(res.threads[0]).toMatchObject({ title: "Lehrkraft Lindqvist" });
    expect(res.threads[0]!.lastMessage?.preview).toMatch(/^Hi Ich, Schüler:in-[0-9A-F]{4} has your notebook\.$/);
    expect(res.threads[3]!.title).toBe("Gruppe (6 Teilnehmende) mit Lehrkraft Lindqvist");
  });
});

describe("itslearning_get_message_thread", () => {
  test("chronological, deleted messages empty, attachment name redacted, external link kept", async () => {
    const ctx = await fakeContext();
    const res = await getThread(ctx, { threadId: 9001 });
    expect(res.messages.map((m) => m.messageId)).toEqual([499, 500, 501, 502]);
    const [m499, m500, , m502] = res.messages;
    expect(m499).toMatchObject({ from: { display: "Me", role: "self" }, text: "I'll bring it tomorrow, Teacher Lindqvist." });
    expect(m500).toMatchObject({ deleted: true, text: "" });
    expect(m502!.attachment).toEqual({ fileRef: "m_9001_502", name: "Notes_Me_Me.pdf", kind: "file" });
    expect(m502!.link).toEqual({ url: "https://example.org/video", title: "Video" });
    expect(res.title).toBe("Teacher Lindqvist");
    expect(res).not.toHaveProperty("total");
    expect(res.hasMore).toBe(false); // fewer messages than the limit
  });

  test("a full page means there may be older messages", async () => {
    const res = await getThread(await fakeContext(), { threadId: 9001, limit: 4 });
    expect(res.hasMore).toBe(true);
    expect(res.olderBeforeMessageId).toBe(499);
  });
});

describe("itslearning_overview", () => {
  test("summarizes tasks, news and unread messages; hides old leftovers", async () => {
    const res = await overview(await fakeContext(), { days: 7 });
    expect(res.overdue.map((t) => t.elementId)).toEqual([7002]); // 7005 (inactive course) and 7006 (too old) hidden
    expect(res.dueSoon.map((t) => t.elementId)).toEqual([7001]);
    expect(res.news.map((n) => n.id)).toEqual([8001, 8002]);
    expect(res.unreadThreads).toBe(2);
    expect(res.unreadThreadsPreview.map((t) => t.threadId)).toEqual([9001, 9003]);
  });

  test("overdueMaxAgeDays widens the window, inactive courses stay hidden", async () => {
    const res = await overview(await fakeContext(), { days: 7, overdueMaxAgeDays: 365 });
    expect(res.overdue.map((t) => t.elementId)).toEqual([7006, 7002]);
  });
});

describe("Leak test via the MCP protocol", () => {
  test("no first names, no student names, no tokens/internal links in any output", async () => {
    const ctx = await fakeContext();
    const server = createServer(ctx);
    const client = new Client({ name: "leak-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const calls: [string, Record<string, unknown>][] = [
      ["itslearning_overview", {}],
      ["itslearning_list_courses", { includeInactive: true }],
      ["itslearning_list_tasks", { status: "all" }],
      ["itslearning_get_task", { elementId: 7001 }],
      ["itslearning_list_news", {}],
      ["itslearning_list_bulletins", { courseId: 12 }],
      ["itslearning_list_message_threads", {}],
      ["itslearning_get_message_thread", { threadId: 9001 }],
    ];
    const outputs: string[] = [];
    for (const [name, args] of calls) {
      const res = await client.callTool({ name, arguments: args });
      expect(res.isError, `${name} should not fail`).toBeFalsy();
      outputs.push(JSON.stringify(res));
    }
    const all = outputs.join("\n");

    for (const n of FORBIDDEN_NAMES) expect(all, `"${n}" must not appear`).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(all).not.toMatch(/Token=|SECRET|filerepository|filecache|itslearning\.com\/|@school\.example|PersonId/);
    // Allowed: teacher last names
    expect(all).toContain("Teacher Lindqvist");
    // Pseudonyms of other people do appear
    expect(all).toContain(ctx.redactor.people.resolve(P_STUDENT.PersonId).display);
    expect(ctx.redactor.people.role(P_UNKNOWN.PersonId)).toBe("teacher"); // bulletin author → teacher (weak hint)
    expect(ctx.redactor.people.role(P_TEACHER.PersonId)).toBe("teacher");
  });
});
