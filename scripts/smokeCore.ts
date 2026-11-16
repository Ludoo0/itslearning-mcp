/**
 * Kern des Smoke-Tests (siehe scripts/smoke.ts): ruft alle Tools auf und prüft die Ausgaben
 * gegen echte Namen aus der API sowie Geheimnis-Muster. Gibt nur Zählungen aus.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiPublishedBy } from "../src/api/types";
import type { AppContext } from "../src/context";
import { STOPWORDS } from "../src/redaction/freetext";

export type SmokeOptions = { redactTeachers: boolean; details?: boolean; out?: (line: string) => void };
export type SmokeResult = { leaks: number; runs: { tool: string; ok: boolean; code?: string }[]; participantsStatus: Record<string, string> };

export async function runSmoke(ctx: AppContext, client: Client, opts: SmokeOptions): Promise<SmokeResult> {
  const out = opts.out ?? ((l: string) => console.log(l));
  const DETAILS = opts.details ?? false;
  const cfg = { redactTeachers: opts.redactTeachers };
  // ---------- Tool-Aufrufe ----------

  type Run = { tool: string; ok: boolean; code?: string; ms: number; output: string; data?: Record<string, unknown> };
  const runs: Run[] = [];

  /** Text + strukturierte Daten, OHNE Datei-/Bild-Inhalte (die sind per Definition nicht geschwärzt). */
  function outputOf(res: CallToolResult): string {
    const parts = res.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`));
    return parts.join("\n") + "\n" + JSON.stringify(res.structuredContent ?? {});
  }

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown> | undefined> {
    const t0 = performance.now();
    const res = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    const data = res.structuredContent as Record<string, unknown> | undefined;
    const code = res.isError ? ((data?.error as { code?: string })?.code ?? "ERROR") : undefined;
    const run: Run = { tool: `${tool} ${Object.keys(args).length ? JSON.stringify(Object.keys(args)) : ""}`.trim(), ok: !res.isError, code, ms: Math.round(performance.now() - t0), output: outputOf(res), data };
    runs.push(run);
    out(`${run.ok ? "✅" : "⚠️ "} ${run.tool.padEnd(52)} ${String(run.ms).padStart(5)} ms${code ? `  ${code}` : ""}`);
    return res.isError ? undefined : data;
  }

  type Obj = Record<string, any>;
  const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

  const overview = await call("itslearning_overview");
  if (!overview && runs[0]?.code === "AUTH_FAILED") {
    console.error("\nAnmeldung fehlgeschlagen – Abbruch.");
    process.exit(1);
  }
  const courses = arr((await call("itslearning_list_courses"))?.courses);
  const tasks = arr((await call("itslearning_list_tasks", { status: "all", limit: 50 }))?.tasks);
  const taskWithFiles = tasks[0];
  let taskDetail: Obj | undefined;
  if (taskWithFiles) taskDetail = await call("itslearning_get_task", { elementId: taskWithFiles.elementId });
  const news = arr((await call("itslearning_list_news", { limit: 20 }))?.items);

  const courseForBulletins = courses.find((c) => c.newBulletins > 0) ?? courses[0];
  const bulletins = courseForBulletins ? arr((await call("itslearning_list_bulletins", { courseId: courseForBulletins.courseId, limit: 10 }))?.bulletins) : [];

  const threads = arr((await call("itslearning_list_message_threads", { limit: 20 }))?.threads);
  const threadMsgs: Obj[] = [];
  for (const t of threads.slice(0, 3)) threadMsgs.push(...arr((await call("itslearning_get_message_thread", { threadId: t.threadId, limit: 30 }))?.messages));

  // Kurs mit Dateien suchen (max. 4 Kurse probieren)
  let courseFiles: Obj[] = [];
  let fileCourseId: number | undefined;
  for (const c of courses.slice(0, 4)) {
    const items = arr((await call("itslearning_list_course_files", { courseId: c.courseId, recursive: true, maxDepth: 2 }))?.items);
    if (items.some((i) => i.fileRef)) {
      courseFiles = items;
      fileCourseId = c.courseId;
      break;
    }
  }

  // Downloads (Text-Modus bzw. auto ohne Blob-Inhalt in der Prüfung)
  const fileRefs = new Set<string>();
  for (const i of courseFiles.filter((x) => x.fileRef).slice(0, 3)) fileRefs.add(i.fileRef);
  for (const f of arr(taskDetail?.files).slice(0, 1)) fileRefs.add(f.fileRef);
  for (const m of threadMsgs.filter((x) => x.attachment).slice(0, 2)) fileRefs.add(m.attachment.fileRef);
  for (const bl of bulletins) for (const img of arr(bl.images).slice(0, 1)) fileRefs.add(img.fileRef);
  for (const ref of fileRefs) await call("itslearning_download_file", { fileRef: ref });

  // ---------- Echte Namen direkt über die API sammeln ----------

  type NameRec = { id: number; first?: string; last?: string; full?: string };
  const names = new Map<number, NameRec>();
  const add = (id: number | null | undefined, n: Partial<NameRec>) => {
    if (typeof id !== "number") return;
    const r = names.get(id) ?? { id };
    for (const k of ["first", "last", "full"] as const) if (n[k]?.trim()) r[k] = n[k]!.trim();
    names.set(id, r);
  };
  const addPub = (p?: ApiPublishedBy | null) => p && add(p.PersonId, { first: p.FirstName ?? undefined, last: p.LastName ?? undefined, full: p.FullName ?? undefined });

  const me = await ctx.it.person();
  add(me.PersonId, { first: me.FirstName ?? undefined, last: me.LastName ?? undefined, full: me.FullName ?? undefined });
  for (const t of (await ctx.it.messageThreads(100)).Threads?.EntityArray ?? []) {
    for (const p of t.Participants ?? []) add(p.PersonId, { first: p.FirstName ?? undefined, last: p.LastName ?? undefined, full: p.FullName ?? undefined });
    if (t.LastMessage) add(t.LastMessage.CreatedBy, { full: t.LastMessage.CreatedByName ?? undefined });
  }
  for (const n of (await ctx.it.notificationStream(0, 50)).EntityArray ?? []) {
    addPub(n.PublishedBy);
    addPub(n.LightBulletin?.PublishedBy);
  }
  const participantsStatus: Record<string, string> = {};
  for (const c of [courseForBulletins?.courseId, fileCourseId].filter((x): x is number => typeof x === "number")) {
    try {
      const parts = await ctx.it.courseParticipants(c);
      participantsStatus[`Kurs ${Object.keys(participantsStatus).length + 1}`] = `abrufbar (${parts.length} Personen)`;
      for (const p of parts) add(p.PersonId, { full: p.FullName ?? undefined });
    } catch (e) {
      participantsStatus[`Kurs ${Object.keys(participantsStatus).length + 1}`] = `NICHT abrufbar (${(e as { code?: string }).code ?? "Fehler"})`;
    }
  }

  // ---------- Verbotene / erlaubte Begriffe ----------

  const people = ctx.redactor.people;
  const allowed = new Set<string>();
  const forbidden = new Map<string, string>(); // Begriff (lowercase) → Kategorie
  for (const r of names.values()) {
    const role = people.role(r.id);
    const teacherVisible = role === "teacher" && !cfg.redactTeachers;
    if (teacherVisible && r.last) allowed.add(r.last.toLowerCase());
    const cat = role === "self" ? "eigenes Konto" : role === "teacher" ? "Lehrkraft" : role === "student" ? "Schüler:in" : "Person (Rolle unbekannt)";
    const terms: [string | undefined, string][] = [
      [r.full, `${cat}: Vollname`],
      [r.first, `${cat}: Vorname`],
      [teacherVisible ? undefined : r.last, `${cat}: Nachname`],
    ];
    // Vollname ohne Feldtrennung (Kurs-Teilnehmer:innen): wie die Registry trennen –
    // "Nachname, Vorname" bzw. "Vorname … Nachname"
    if (r.full && !r.first && !r.last) {
      const words = r.full.split(/\s+/).filter(Boolean);
      const [lastPart, firstPart] = r.full.includes(",")
        ? r.full.split(",", 2).map((x) => x.trim())
        : [words.at(-1) ?? "", words.slice(0, -1).join(" ")];
      if (teacherVisible && lastPart) allowed.add(lastPart.toLowerCase());
      for (const p of (firstPart ?? "").split(/\s+/)) terms.push([p, `${cat}: Vorname (aus Vollname)`]);
      if (!teacherVisible) for (const p of (lastPart ?? "").split(/\s+/)) terms.push([p, `${cat}: Nachname (aus Vollname)`]);
    }
    for (const [t, c] of terms) {
      const k = t?.toLowerCase();
      if (!k || k.length < 3 || STOPWORDS.has(k)) continue;
      if (!forbidden.has(k)) forbidden.set(k, c);
    }
  }
  let ambiguous = 0;
  for (const k of [...forbidden.keys()]) if (allowed.has(k)) {
    forbidden.delete(k);
    ambiguous++;
  }

  const SECRET_PATTERNS: [string, RegExp][] = [
    ["Token-Parameter", /[?&](Token|Signature|sign|Hash|ApiSessionId)=/i],
    ["Datei-Server-URL", /filerepository\.itslearning|filecache\.itslearning/i],
    ["Session-/SSO-URL", /LoginSSO|ProcessLogin|MobileAppLoginSso|DownloadRedirect|ViewFile\.aspx|File\/View\.aspx/i],
    ["interne itslearning-URL", /https?:\/\/[\w.-]*itslearning\.com\//i],
    ["E-Mail-Adresse", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}]{2,}/u],
    ["PersonId", /PersonId/],
  ];

  // ---------- Prüfung ----------

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mask = (s: string) => s[0] + "*".repeat(Math.max(1, s.length - 1));
  // Struktur rund um einen Treffer: Buchstaben → x, Ziffern → 9. Nur die eigenen Anzeigewörter des
  // Servers (Lehrkraft, Frau, Schüler:in …) bleiben lesbar – sie verraten nichts, zeigen aber den Kontext.
  const DISPLAY_WORDS = /^(Lehrkraft|Frau|Herr|Herrn|Schüler:in|Person|Ich|Name|Unbekannt)$/;
  const shape = (t: string) =>
    t
      .replace(/\s+/g, " ")
      .split(/( )/)
      .map((w) => (DISPLAY_WORDS.test(w.replace(/[^\p{L}:]/gu, "")) ? w.replace(/\p{N}/gu, "9") : w.replace(/\p{L}/gu, "x").replace(/\p{N}/gu, "9")))
      .join("");
  const around = (text: string, i: number, len: number, middle: string) =>
    shape(text.slice(Math.max(0, i - 40), i)) + middle + shape(text.slice(i + len, i + len + 40));

  let leaks = 0;
  out("\nLeak-Prüfung");
  for (const run of runs) {
    const hits = new Map<string, Set<string>>();
    const structures = new Map<string, string[]>();
    for (const [term, cat] of forbidden) {
      const ms = [...run.output.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, "giu"))];
      if (!ms.length) continue;
      if (!hits.has(cat)) hits.set(cat, new Set());
      hits.get(cat)!.add(term);
      const list = structures.get(cat) ?? [];
      for (const m of ms.slice(0, 2)) if (list.length < 3) list.push(around(run.output, m.index ?? 0, m[0].length, "⟨Treffer⟩"));
      structures.set(cat, list);
    }
    for (const [label, re] of SECRET_PATTERNS) {
      if (!re.test(run.output)) continue;
      hits.set(label, new Set(["(Muster)"]));
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      structures.set(label, [...run.output.matchAll(g)].slice(0, 3).map((m) => around(run.output, m.index ?? 0, m[0].length, m[0].replace(/\p{N}/gu, "9"))));
    }
    if (!hits.size) continue;
    leaks += [...hits.values()].reduce((n, s) => n + s.size, 0);
    const kind = run.data ? [run.data.kind, run.data.mimeType].filter(Boolean).join(", ") : "";
    out(`❌ ${run.tool}${kind ? `  (${kind})` : ""}`);
    for (const [cat, terms] of hits) {
      out(`     ${cat}: ${terms.size} Treffer${DETAILS && !terms.has("(Muster)") ? ` (${[...terms].map(mask).join(", ")})` : ""}`);
      if (DETAILS) for (const st of structures.get(cat) ?? []) out(`       Struktur: …${st}…`);
    }
  }
  if (!leaks) out("✅ keine Treffer");

  // ---------- Zusammenfassung ----------

  const roles = { teacher: 0, student: 0, unknown: 0 };
  for (const r of names.values()) {
    const role = people.role(r.id);
    if (role in roles) roles[role as keyof typeof roles]++;
  }
  out(`
  Zusammenfassung
    Tool-Aufrufe:       ${runs.length} (${runs.filter((r) => r.ok).length} ok, ${runs.filter((r) => !r.ok).length} mit Fehlercode)
    Fehlercodes:        ${[...new Set(runs.filter((r) => r.code).map((r) => r.code))].join(", ") || "–"}
    Downloads getestet: ${fileRefs.size}
    Geprüfte Namen:     ${forbidden.size} Begriffe von ${names.size} Personen (${ambiguous} mehrdeutig übersprungen)
    Rollen erkannt:     ${roles.teacher} Lehrkräfte, ${roles.student} Schüler:innen, ${roles.unknown} unbekannt
    Teilnehmerlisten:   ${Object.entries(participantsStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "nicht geprüft"}
    Ergebnis:           ${leaks ? `❌ ${leaks} mögliche Leaks` : "✅ keine Leaks gefunden"}`);

  return { leaks, runs, participantsStatus };
}
