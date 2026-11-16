import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/app";
import { ToolError } from "../src/errors";
import { FileCache } from "../src/files/cache";
import { extractText } from "../src/files/extract";
import { formatRef, parseRef } from "../src/files/refs";
import { extractLinks, filenameFromDisposition, readLimited } from "../src/websession/browser";
import { downloadFile, listCourseFiles } from "../src/tools/files";
import { getThread } from "../src/tools/messages";
import { FORBIDDEN_NAMES, fakeContext } from "./fixtures";
import { SECRET_MARKERS, createFakeWeb, makePdf } from "./fakeWeb";

const texts = (r: CallToolResult) => r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text);

describe("Bausteine", () => {
  test("fileRefs: Format und Parsing, unbekannte Formate → FILE_REF_UNKNOWN", () => {
    for (const s of [
      { kind: "element", elementId: 1 },
      { kind: "assignment", elementId: 1, fileId: 2 },
      { kind: "message", threadId: 3, messageId: 4 },
      { kind: "bulletinImage", courseId: 5, bulletinId: 6, index: 0 },
    ] as const) {
      expect(parseRef(formatRef(s))).toEqual(s);
    }
    for (const bad of ["x_1", "e_1_2", "a_1", "e_abc", "../etc/passwd", ""]) {
      expect(() => parseRef(bad)).toThrow(ToolError);
    }
  });

  test("Content-Disposition: filename* (UTF-8) vor filename", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Br%C3%BCche.pdf; filename=\"x.pdf\"")).toBe("Brüche.pdf");
    expect(filenameFromDisposition('inline; filename="Blatt 1.docx"')).toBe("Blatt 1.docx");
    expect(filenameFromDisposition(null)).toBeUndefined();
  });

  test("extractLinks bevorzugt DownloadRedirect und ignoriert Icons", () => {
    const l = extractLinks(
      '<img src="/App_Themes/Default/images/file.gif"><a href="https://filerepository.itslearning.com/a?Download=1">x</a><a href="/Proxy/DownloadRedirect.ashx?LearningObjectId=1&amp;LearningObjectInstanceId=2">y</a><iframe src="/inner.aspx"></iframe>',
      "https://resource.itslearning.com/File/View.aspx",
    );
    expect(l.downloads[0]).toBe("https://resource.itslearning.com/Proxy/DownloadRedirect.ashx?LearningObjectId=1&LearningObjectInstanceId=2");
    expect(l.downloads).toHaveLength(2);
    expect(l.iframes).toEqual(["https://resource.itslearning.com/inner.aspx"]);
  });

  test("readLimited bricht bei Überschreitung ab", async () => {
    await expect(readLimited(new Response("x".repeat(2000)), 1000)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    await expect(readLimited(new Response("x", { headers: { "content-length": "99999" } }), 1000)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect((await readLimited(new Response("abc"), 1000)).byteLength).toBe(3);
  });

  test("PDF-Textextraktion (unpdf)", async () => {
    expect(await extractText(makePdf("Hallo Welt 123"), "application/pdf", "a.pdf")).toContain("Hallo Welt 123");
  });
});

describe("itslearning_list_course_files", () => {
  test("Root-Ordner mit fileRefs für Elemente", async () => {
    const res = await listCourseFiles(await fakeContext(), { courseId: 11 });
    expect(res.items.map((i) => [i.elementId, i.kind, i.fileRef])).toEqual([
      [7300, "folder", undefined],
      [7201, "element", "e_7201"],
      [7202, "element", "e_7202"],
    ]);
  });

  test("rekursiv inkl. Unterordner", async () => {
    const res = await listCourseFiles(await fakeContext(), { courseId: 11, recursive: true });
    const sub = res.items.find((i) => i.elementId === 7203);
    expect(sub).toMatchObject({ depth: 1, parentFolderId: 7300, fileRef: "e_7203" });
  });
});

describe("itslearning_download_file", () => {
  test("Kurs-Datei über die komplette Web-Kette; Text geschwärzt, kein Blob im auto-Modus", async () => {
    const web = createFakeWeb();
    const res = await downloadFile(await fakeContext({}, { web }), { fileRef: "e_7201" });
    const meta = res.structuredContent as Record<string, unknown>;
    expect(meta).toMatchObject({ kind: "file", name: "Arbeitsblatt_Ich_Ich.txt", mimeType: "text/plain", textIncluded: true, blobIncluded: false, cached: false });
    const body = texts(res).join("\n");
    expect(body).toContain("Arbeitsblatt für Ich");
    expect(body).toContain("Fragen an [E-Mail]");
    expect(res.content.some((c) => c.type === "resource")).toBe(false);
    // Kette wirklich durchlaufen
    expect(web.stats.requests).toEqual(
      expect.arrayContaining([
        "demo.itslearning.com/SSO/MobileAppLoginSso.aspx",
        "platform.itslearning.com/LoginSSO.aspx",
        "resource.itslearning.com/Proxy/DownloadRedirect.ashx",
        "filecache.itslearning.com/c/f1",
      ]),
    );
  });

  test("abgelaufene Web-Session → automatisch neue Session", async () => {
    const web = createFakeWeb();
    const ctx = await fakeContext({}, { web });
    web.expireSessionOnce();
    const res = await downloadFile(ctx, { fileRef: "e_7201" });
    expect(res.isError).toBeFalsy();
    expect(web.stats.loginPagesServed).toBe(1);
  });

  test("Element ohne Datei → Seite mit geschwärztem Text", async () => {
    const ctx = await fakeContext();
    const res = await downloadFile(ctx, { fileRef: "e_7202" });
    const data = res.structuredContent as { kind: string; text: string };
    expect(data.kind).toBe("page");
    expect(data.text).toContain("Notiz");
    expect(data.text).not.toMatch(/Mia|Sonnenfeld|FILETOKEN/);
  });

  test("Kurs-Teilnehmer:innen schützen Namen, die nie in einer Unterhaltung vorkamen", async () => {
    const noThreads = { messageThreads: async () => ({ Threads: { EntityArray: [], Total: 0, CurrentPageIndex: 0, PageSize: 0 }, HasMore: false }) };
    const ctx = await fakeContext(noThreads);
    expect(ctx.redactor.people.role(3001)).toBe("unknown"); // Mia ist noch unbekannt
    const res = await downloadFile(ctx, { fileRef: "e_7202" });
    const text = (res.structuredContent as { text: string }).text;
    expect(text).toMatch(/Hallo Schüler:in-[0-9A-F]{4}/);
    expect(ctx.redactor.people.role(2001)).toBe("teacher"); // Rolle aus dem Kurs-Profil
  });

  test("Teilnehmerliste nicht abrufbar → Download funktioniert trotzdem", async () => {
    const ctx = await fakeContext({ courseParticipants: async () => Promise.reject(new Error("403")) });
    expect((await downloadFile(ctx, { fileRef: "e_7201" })).isError).toBeFalsy();
  });

  test("Ordner → NOT_A_FILE", async () => {
    await expect(downloadFile(await fakeContext(), { fileRef: "e_7300" })).rejects.toMatchObject({ code: "NOT_A_FILE" });
  });

  test("Nachrichten-Anhang (PDF): Text extrahiert und geschwärzt; mode=both liefert zusätzlich die Datei", async () => {
    const ctx = await fakeContext();
    await getThread(ctx, { threadId: 9001 }); // registriert Personen + merkt sich die Anhang-URL
    const res = await downloadFile(ctx, { fileRef: "m_9001_502", mode: "both" });
    expect(res.structuredContent).toMatchObject({ mimeType: "application/pdf", name: "Notizen_Ich_Ich.pdf", textIncluded: true, blobIncluded: true });
    const body = texts(res).join("\n");
    expect(body).toMatch(/Notizen von Ich und Schüler:in-[0-9A-F]{4}/);
    const blob = res.content.find((c) => c.type === "resource") as { resource: { blob: string; uri: string } };
    expect(blob.resource.uri).toBe("itslearning-file:m_9001_502");
    expect(Buffer.from(blob.resource.blob, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("Nachrichten-Anhang auch ohne vorheriges Listing (zustandslos auflösbar)", async () => {
    const res = await downloadFile(await fakeContext(), { fileRef: "m_9001_502", mode: "text" });
    expect(res.structuredContent).toMatchObject({ textIncluded: true });
  });

  test("Aufgaben-Anhang über Redirect; Name aus filename* geschwärzt", async () => {
    const res = await downloadFile(await fakeContext(), { fileRef: "a_7001_1" });
    expect(res.structuredContent).toMatchObject({ name: "Brüche_Ich.txt", mimeType: "text/plain" });
    expect(texts(res).join("\n")).toContain("Aufgabe von Lehrkraft Lindqvist für Ich");
  });

  test("Bulletin-Bild: im auto-Modus als Bild", async () => {
    const res = await downloadFile(await fakeContext(), { fileRef: "i_12_6001_0" });
    expect(res.structuredContent).toMatchObject({ kind: "image", mimeType: "image/png", blobIncluded: true });
    expect(res.content.some((c) => c.type === "image")).toBe(true);
  });

  test("mode=text bei nicht extrahierbarer Datei → NOT_A_FILE", async () => {
    await expect(downloadFile(await fakeContext(), { fileRef: "i_12_6001_0", mode: "text" })).rejects.toMatchObject({ code: "NOT_A_FILE" });
  });

  test("Größenlimit", async () => {
    await expect(downloadFile(await fakeContext({}, { maxBytes: 10 }), { fileRef: "e_7201" })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  test("unbekannte Nachricht → FILE_REF_UNKNOWN", async () => {
    await expect(downloadFile(await fakeContext(), { fileRef: "m_9001_999" })).rejects.toMatchObject({ code: "FILE_REF_UNKNOWN" });
  });
});

describe("Cache und DOWNLOAD_DIR", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "itsl-files-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("zweiter Download kommt aus dem Cache", async () => {
    const web = createFakeWeb();
    const ctx = await fakeContext({}, { web, cache: new FileCache(join(dir, "cache")) });
    await downloadFile(ctx, { fileRef: "e_7201" });
    const before = web.stats.requests.length;
    const res = await downloadFile(ctx, { fileRef: "e_7201" });
    expect(res.structuredContent).toMatchObject({ cached: true });
    expect(web.stats.requests.length).toBe(before);
  });

  test("Cache läuft nach TTL ab", async () => {
    let now = 0;
    const cache = new FileCache(join(dir, "cache"), 1000, 10_000_000, () => now);
    cache.put("e_1", { name: "a.txt", mimeType: "text/plain", size: 1 }, new Uint8Array([65]));
    expect(cache.get("e_1")?.meta.name).toBe("a.txt");
    now = 2000;
    expect(cache.get("e_1")).toBeUndefined();
  });

  test("DOWNLOAD_DIR: Datei mit geschwärztem Namen ablegen", async () => {
    const ctx = await fakeContext({}, { downloadDir: join(dir, "dl") });
    const res = await downloadFile(ctx, { fileRef: "e_7201" });
    const files = await readdir(join(dir, "dl"));
    expect(files).toEqual(["e_7201_Arbeitsblatt_Ich_Ich.txt"]);
    expect((res.structuredContent as { savedTo: string }).savedTo).toContain("e_7201_Arbeitsblatt_Ich_Ich.txt");
    expect(await readFile(join(dir, "dl", files[0]!), "utf8")).toContain("Jonas"); // Datei-Inhalt selbst ist NICHT geschwärzt (dokumentiert)
  });
});

describe("Leak-Test Dateien über das MCP-Protokoll", () => {
  test("keine Tokens, Signaturen, Session-URLs oder Namen in Ausgaben (außer Blob-Inhalt)", async () => {
    const ctx = await fakeContext();
    const server = createServer(ctx);
    const client = new Client({ name: "leak-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const outputs: string[] = [];
    for (const [name, args] of [
      ["itslearning_get_task", { elementId: 7001 }],
      ["itslearning_list_bulletins", { courseId: 12 }],
      ["itslearning_get_message_thread", { threadId: 9001 }],
      ["itslearning_list_course_files", { courseId: 11, recursive: true }],
      ["itslearning_download_file", { fileRef: "e_7201" }],
      ["itslearning_download_file", { fileRef: "e_7202" }],
      ["itslearning_download_file", { fileRef: "m_9001_502", mode: "text" }],
      ["itslearning_download_file", { fileRef: "a_7001_1" }],
    ] as const) {
      const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
      expect(res.isError, `${name} ${JSON.stringify(args)}`).toBeFalsy();
      outputs.push(JSON.stringify(res));
    }
    const all = outputs.join("\n");
    for (const m of SECRET_MARKERS) expect(all, `Geheimnis "${m}"`).not.toContain(m);
    expect(all).not.toMatch(/filerepository|filecache|LoginSSO|ProcessLogin|MobileAppLoginSso|DownloadRedirect|itslearning\.com\//);
    for (const n of FORBIDDEN_NAMES) expect(all, `Name "${n}"`).not.toMatch(new RegExp(`\\b${n}\\b`));
  });
});
