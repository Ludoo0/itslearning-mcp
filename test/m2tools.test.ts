import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import { listBulletins } from "../src/tools/bulletins";
import { getThread, listThreads } from "../src/tools/messages";
import { listNews } from "../src/tools/news";
import { overview } from "../src/tools/overview";
import { FORBIDDEN_NAMES, P_STUDENT, P_TEACHER, P_UNKNOWN, fakeContext } from "./fixtures";

describe("itslearning_list_news", () => {
  test("neueste zuerst, since-Filter, Arten, Autor:innen und geschwärzte Texte", async () => {
    const ctx = await fakeContext();
    const res = await listNews(ctx, { since: "2026-11-09" });
    expect(res.items.map((i) => i.id)).toEqual([8001, 8002]);
    const [bulletin, element] = res.items;
    expect(bulletin).toMatchObject({ kind: "bulletin", bulletinId: 6001, imageCount: 1, courseId: 12, author: { display: "Lehrkraft Lindqvist", role: "teacher" } });
    expect(bulletin!.text).toBe("Liebe Klasse, Abgabe bei Lehrkraft Lindqvist. Fragen: [E-Mail]");
    expect(element).toMatchObject({ kind: "element", elementId: 7001, author: { role: "unknown" } });
    expect(element!.text).toMatch(/^Neue Aufgabe: Arbeitsblatt Brüche \(von Person-[0-9A-F]{4}\)$/);
  });

  test("Kursfilter", async () => {
    const res = await listNews(await fakeContext(), { courseId: 11 });
    expect(res.items.map((i) => i.id)).toEqual([8002, 8003]);
  });
});

describe("itslearning_list_bulletins", () => {
  test("Ressourcen, Links nur wenn teilbar, Paging", async () => {
    const res = await listBulletins(await fakeContext(), { courseId: 12 });
    expect(res.total).toBe(2);
    const [b1, b2] = res.bulletins;
    expect(b1).toMatchObject({ pinned: true, link: "https://example.org/info", imageCount: 1, commentsCount: 2 });
    expect(b1!.resources).toEqual([{ elementId: 7101, title: "Leseliste", type: "LearningToolElement" }]);
    expect(b2!.link).toBeUndefined();
    expect(b2!.text).toBe("Siehe [itslearning-Link]");
    expect(b2!.author?.role).toBe("teacher"); // Bulletin-Autor (schwaches Indiz)
  });
});

describe("itslearning_list_message_threads", () => {
  test("Titel, Teilnehmer, Ungelesen-Status", async () => {
    const ctx = await fakeContext();
    const res = await listThreads(ctx, {});
    const [t1, t2, t3] = res.threads;
    const mia = ctx.redactor.people.resolve(P_STUDENT.PersonId).display;

    expect(t1).toMatchObject({ threadId: 9001, title: "Lehrkraft Lindqvist", unread: true, participantsCount: 2 });
    expect(t1!.lastMessage?.preview).toBe(`Hallo Ich, ${mia} hat dein Heft.`);
    expect(t2).toMatchObject({ title: `Projekt mit ${mia}`, unread: false });
    expect(t2!.participants.map((p) => p.display)).toContain("Lehrkraft Brandauer"); // über CreatedByTeacher
    expect(t3).toMatchObject({ title: "Deutsch 8b", unread: true, participantsCount: 7 });
    expect(t3!.participants).toEqual([{ display: "Lehrkraft Lindqvist", role: "teacher" }]); // große Gruppe: nur Lehrkräfte
  });

  test("Filter unreadOnly und type", async () => {
    const ctx = await fakeContext();
    expect((await listThreads(ctx, { unreadOnly: true })).threads.map((t) => t.threadId)).toEqual([9001, 9003]);
    expect((await listThreads(ctx, { type: "Group" })).threads.map((t) => t.threadId)).toEqual([9002]);
  });
});

describe("itslearning_get_message_thread", () => {
  test("chronologisch, gelöschte Nachrichten leer, Anhang-Name geschwärzt, externer Link bleibt", async () => {
    const ctx = await fakeContext();
    const res = await getThread(ctx, { threadId: 9001 });
    expect(res.messages.map((m) => m.messageId)).toEqual([499, 500, 501, 502]);
    const [m499, m500, , m502] = res.messages;
    expect(m499).toMatchObject({ from: { display: "Ich", role: "self" }, text: "Ich bringe es morgen, Lehrkraft Lindqvist." });
    expect(m500).toMatchObject({ deleted: true, text: "" });
    expect(m502!.attachmentName).toBe("Notizen_Ich_Ich.pdf");
    expect(m502!.link).toEqual({ url: "https://example.org/lernvideo", title: "Lernvideo" });
    expect(res.title).toBe("Lehrkraft Lindqvist");
  });
});

describe("itslearning_overview", () => {
  test("fasst Aufgaben, Neuigkeiten und ungelesene Nachrichten zusammen", async () => {
    const res = await overview(await fakeContext(), { days: 7 });
    expect(res.overdue.map((t) => t.elementId)).toEqual([7002]);
    expect(res.dueSoon.map((t) => t.elementId)).toEqual([7001]);
    expect(res.news.map((n) => n.id)).toEqual([8001, 8002]);
    expect(res.unreadThreads).toBe(2);
    expect(res.unreadThreadsPreview.map((t) => t.threadId)).toEqual([9001, 9003]);
  });
});

describe("Leak-Test über das MCP-Protokoll", () => {
  test("keine Vornamen, keine Schüler:innen-Namen, keine Tokens/internen Links in irgendeiner Ausgabe", async () => {
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
      expect(res.isError, `${name} sollte nicht fehlschlagen`).toBeFalsy();
      outputs.push(JSON.stringify(res));
    }
    const all = outputs.join("\n");

    for (const n of FORBIDDEN_NAMES) expect(all, `"${n}" darf nicht vorkommen`).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(all).not.toMatch(/Token=|SECRET|filerepository|filecache|itslearning\.com\/|@schule\.example|PersonId/);
    // Erlaubt: Nachnamen von Lehrkräften
    expect(all).toContain("Lehrkraft Lindqvist");
    // Pseudonyme der übrigen Personen tauchen auf
    expect(all).toContain(ctx.redactor.people.resolve(P_STUDENT.PersonId).display);
    expect(ctx.redactor.people.role(P_UNKNOWN.PersonId)).toBe("teacher"); // Bulletin-Autor → Lehrkraft (Indiz)
    expect(ctx.redactor.people.role(P_TEACHER.PersonId)).toBe("teacher");
  });
});
