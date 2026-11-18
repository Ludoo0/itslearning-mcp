/**
 * Core of the smoke test (see scripts/smoke.ts): calls every tool and checks all output against
 * real names fetched from the API plus secret patterns. Prints counts and masked structure only.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiPublishedBy } from "../src/api/types";
import type { AppContext } from "../src/context";
import { STOPWORDS } from "../src/redaction/freetext";

export type SmokeOptions = { redactTeachers: boolean; details?: boolean; out?: (line: string) => void };
export type SmokeResult = {
  leaks: number;
  runs: { tool: string; ok: boolean; code?: string }[];
  participantsStatus: Record<string, string>;
};

/** Display words the server inserts itself (all label languages) – never sensitive, kept readable in structures. */
const DISPLAY_WORDS =
  /^(Me|Teacher|Student|Child|Person|Unknown|Mr|Mrs|Ms|Miss|Dr|name|Ich|Lehrkraft|Schüler:in|Kind|Frau|Herr|Herrn|Name|Unbekannt|Jeg|Lærer|Elev|Barn|Ukjent|navn|Jag|Lärare|Okänd|namn|Fru|Fröken|Ik|Docent|Leerling|Persoon|Onbekend|naam|Mevrouw|Mevr|Mw|Meneer|Dhr|Juf|Juffrouw|Meester|Moi|Enseignant|Élève|Enfant|Personne|Inconnu|nom|Madame|Mme|Mademoiselle|Mlle|Monsieur|M)$/;

export async function runSmoke(ctx: AppContext, client: Client, opts: SmokeOptions): Promise<SmokeResult> {
  const out = opts.out ?? ((l: string) => console.log(l));
  const DETAILS = opts.details ?? false;
  const cfg = { redactTeachers: opts.redactTeachers };
  // ---------- Tool calls ----------

  type Run = { tool: string; ok: boolean; code?: string; ms: number; output: string; data?: Record<string, unknown> };
  const runs: Run[] = [];

  /** Text + structured data, WITHOUT file/image content (which is unredacted by definition). */
  function outputOf(res: CallToolResult): string {
    const parts = res.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`));
    return `${parts.join("\n")}\n${JSON.stringify(res.structuredContent ?? {})}`;
  }

  async function call(tool: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown> | undefined> {
    const t0 = performance.now();
    const res = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    const data = res.structuredContent as Record<string, unknown> | undefined;
    const code = res.isError ? ((data?.error as { code?: string })?.code ?? "ERROR") : undefined;
    const run: Run = {
      tool: `${tool} ${Object.keys(args).length ? JSON.stringify(Object.keys(args)) : ""}`.trim(),
      ok: !res.isError,
      code,
      ms: Math.round(performance.now() - t0),
      output: outputOf(res),
      data,
    };
    runs.push(run);
    out(`${run.ok ? "✅" : "⚠️ "} ${run.tool.padEnd(52)} ${String(run.ms).padStart(5)} ms${code ? `  ${code}` : ""}`);
    return res.isError ? undefined : data;
  }

  type Obj = Record<string, any>;
  const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

  const overview = await call("itslearning_overview");
  if (!overview && runs[0]?.code === "AUTH_FAILED") {
    out("\nLogin failed – aborting.");
    return { leaks: -1, runs, participantsStatus: {} };
  }
  // Parent accounts (experimental): empty list for students
  await call("itslearning_list_children");
  const courses = arr((await call("itslearning_list_courses"))?.courses);
  const tasks = arr((await call("itslearning_list_tasks", { status: "all", limit: 50 }))?.tasks);
  // Task details: the first task plus a few others, preferring activities (their text comes from the task's web page)
  const taskSample = [
    ...new Set([tasks[0], ...tasks.filter((t) => t.type === "activity").slice(0, 2), ...tasks.slice(1, 3)].filter(Boolean)),
  ].slice(0, 4);
  let taskDetail: Obj | undefined;
  let pageTasks = 0;
  for (const t of taskSample) {
    const d = await call("itslearning_get_task", { elementId: t.elementId });
    if (d?.detailsSource === "page") pageTasks++;
    if (!taskDetail && arr(d?.files).length) taskDetail = d;
    taskDetail ??= d;
  }
  await call("itslearning_list_news", { limit: 20 });

  const courseForBulletins = courses.find((c) => c.newBulletins > 0) ?? courses[0];
  const bulletins = courseForBulletins
    ? arr((await call("itslearning_list_bulletins", { courseId: courseForBulletins.courseId, limit: 10 }))?.bulletins)
    : [];

  const threads = arr((await call("itslearning_list_message_threads", { limit: 20 }))?.threads);
  const threadMsgs: Obj[] = [];
  for (const t of threads.slice(0, 3))
    threadMsgs.push(...arr((await call("itslearning_get_message_thread", { threadId: t.threadId, limit: 30 }))?.messages));

  // Calendar and planner (empty if the school does not use these features)
  await call("itslearning_list_calendar", { days: 30 });
  await call("itslearning_list_plans", { days: 30 });

  // Find a course with files (try at most 4 courses)
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

  // Downloads (auto mode; blob content is excluded from the check)
  const fileRefs = new Set<string>();
  for (const i of courseFiles.filter((x) => x.fileRef).slice(0, 3)) fileRefs.add(i.fileRef);
  for (const f of arr(taskDetail?.files).slice(0, 1)) fileRefs.add(f.fileRef);
  for (const m of threadMsgs.filter((x) => x.attachment).slice(0, 2)) fileRefs.add(m.attachment.fileRef);
  for (const bl of bulletins) for (const img of arr(bl.images).slice(0, 1)) fileRefs.add(img.fileRef);
  for (const ref of fileRefs) await call("itslearning_download_file", { fileRef: ref });

  // ---------- Collect real names directly from the API ----------

  type NameRec = { id: number; first?: string; last?: string; full?: string };
  const names = new Map<number, NameRec>();
  const add = (id: number | null | undefined, n: Partial<NameRec>) => {
    if (typeof id !== "number") return;
    const r = names.get(id) ?? { id };
    for (const k of ["first", "last", "full"] as const) if (n[k]?.trim()) r[k] = n[k]!.trim();
    names.set(id, r);
  };
  const addPub = (p?: ApiPublishedBy | null) =>
    p && add(p.PersonId, { first: p.FirstName ?? undefined, last: p.LastName ?? undefined, full: p.FullName ?? undefined });

  const me = await ctx.it.person();
  add(me.PersonId, { first: me.FirstName ?? undefined, last: me.LastName ?? undefined, full: me.FullName ?? undefined });
  // Children of a parent account (experimental; empty for students – no request then)
  if (me.Children?.length)
    for (const c of await ctx.it.children().catch(() => me.Children ?? []))
      add(c.PersonId, { first: c.FirstName ?? undefined, last: c.LastName ?? undefined, full: c.FullName ?? undefined });
  for (const t of (await ctx.it.messageThreads(100)).Threads?.EntityArray ?? []) {
    for (const p of t.Participants ?? [])
      add(p.PersonId, { first: p.FirstName ?? undefined, last: p.LastName ?? undefined, full: p.FullName ?? undefined });
    if (t.LastMessage) add(t.LastMessage.CreatedBy, { full: t.LastMessage.CreatedByName ?? undefined });
  }
  for (const n of (await ctx.it.notificationStream(0, 50)).EntityArray ?? []) {
    addPub(n.PublishedBy);
    addPub(n.LightBulletin?.PublishedBy);
  }
  const participantsStatus: Record<string, string> = {};
  for (const c of [courseForBulletins?.courseId, fileCourseId].filter((x): x is number => typeof x === "number")) {
    const key = `course ${Object.keys(participantsStatus).length + 1}`;
    try {
      const parts = await ctx.it.courseParticipants(c);
      participantsStatus[key] = `available (${parts.length} people)`;
      for (const p of parts) add(p.PersonId, { full: p.FullName ?? undefined });
    } catch (e) {
      participantsStatus[key] = `NOT available (${(e as { code?: string }).code ?? "error"})`;
    }
  }

  // ---------- Forbidden / allowed terms ----------

  const people = ctx.redactor.people;
  const allowed = new Set<string>();
  const forbidden = new Map<string, string>(); // term (lowercase) → category
  for (const r of names.values()) {
    const role = people.role(r.id);
    const teacherVisible = role === "teacher" && !cfg.redactTeachers;
    if (teacherVisible && r.last) allowed.add(r.last.toLowerCase());
    const cat =
      role === "self"
        ? "own account"
        : role === "teacher"
          ? "teacher"
          : role === "student"
            ? "student"
            : role === "child"
              ? "child"
              : "person (role unknown)";
    const terms: [string | undefined, string][] = [
      [r.full, `${cat}: full name`],
      [r.first, `${cat}: first name`],
      [teacherVisible ? undefined : r.last, `${cat}: last name`],
    ];
    // Full name without separate fields (course participants): split like the registry does –
    // "Last, First" or "First … Last"
    if (r.full && !r.first && !r.last) {
      const words = r.full.split(/\s+/).filter(Boolean);
      const [lastPart, firstPart] = r.full.includes(",")
        ? r.full.split(",", 2).map((x) => x.trim())
        : [words.at(-1) ?? "", words.slice(0, -1).join(" ")];
      if (teacherVisible && lastPart) allowed.add(lastPart.toLowerCase());
      for (const p of (firstPart ?? "").split(/\s+/)) terms.push([p, `${cat}: first name (from full name)`]);
      if (!teacherVisible) for (const p of (lastPart ?? "").split(/\s+/)) terms.push([p, `${cat}: last name (from full name)`]);
    }
    for (const [t, c] of terms) {
      const k = t?.toLowerCase();
      if (!k || k.length < 3 || STOPWORDS.has(k)) continue;
      if (!forbidden.has(k)) forbidden.set(k, c);
    }
  }
  let ambiguous = 0;
  for (const k of [...forbidden.keys()])
    if (allowed.has(k)) {
      forbidden.delete(k);
      ambiguous++;
    }

  const SECRET_PATTERNS: [string, RegExp][] = [
    ["token parameter", /[?&](Token|Signature|sign|Hash|ApiSessionId)=/i],
    ["file server URL", /filerepository\.itslearning|filecache\.itslearning/i],
    ["session/SSO URL", /LoginSSO|ProcessLogin|MobileAppLoginSso|DownloadRedirect|ViewFile\.aspx|File\/View\.aspx/i],
    ["internal itslearning URL", /https?:\/\/[\w.-]*itslearning\.com\//i],
    ["email address", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}]{2,}/u],
    ["PersonId", /PersonId/],
  ];

  // ---------- Check ----------

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mask = (s: string) => s[0] + "*".repeat(Math.max(1, s.length - 1));
  // Structure around a hit: letters → x, digits → 9. Only the server's own display words
  // (Teacher, Mrs, Student …) stay readable – they reveal nothing but show the context.
  const shape = (t: string) =>
    t
      .replace(/\s+/g, " ")
      .split(/( )/)
      .map((w) =>
        DISPLAY_WORDS.test(w.replace(/[^\p{L}:]/gu, "")) ? w.replace(/\p{N}/gu, "9") : w.replace(/\p{L}/gu, "x").replace(/\p{N}/gu, "9"),
      )
      .join("");
  const around = (text: string, i: number, len: number, middle: string) =>
    shape(text.slice(Math.max(0, i - 40), i)) + middle + shape(text.slice(i + len, i + len + 40));

  let leaks = 0;
  out("\nLeak check");
  for (const run of runs) {
    const hits = new Map<string, Set<string>>();
    const structures = new Map<string, string[]>();
    for (const [term, cat] of forbidden) {
      const ms = [...run.output.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc(term)}(?![\\p{L}\\p{N}])`, "giu"))];
      if (!ms.length) continue;
      if (!hits.has(cat)) hits.set(cat, new Set());
      hits.get(cat)!.add(term);
      const list = structures.get(cat) ?? [];
      for (const m of ms.slice(0, 2)) if (list.length < 3) list.push(around(run.output, m.index ?? 0, m[0].length, "⟨hit⟩"));
      structures.set(cat, list);
    }
    for (const [label, re] of SECRET_PATTERNS) {
      if (!re.test(run.output)) continue;
      hits.set(label, new Set(["(pattern)"]));
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      structures.set(
        label,
        [...run.output.matchAll(g)].slice(0, 3).map((m) => around(run.output, m.index ?? 0, m[0].length, m[0].replace(/\p{N}/gu, "9"))),
      );
    }
    if (!hits.size) continue;
    leaks += [...hits.values()].reduce((n, s) => n + s.size, 0);
    const kind = run.data ? [run.data.kind, run.data.mimeType].filter(Boolean).join(", ") : "";
    out(`❌ ${run.tool}${kind ? `  (${kind})` : ""}`);
    for (const [cat, terms] of hits) {
      out(`     ${cat}: ${terms.size} hit(s)${DETAILS && !terms.has("(pattern)") ? ` (${[...terms].map(mask).join(", ")})` : ""}`);
      if (DETAILS) for (const st of structures.get(cat) ?? []) out(`       structure: …${st}…`);
    }
  }
  if (!leaks) out("✅ no hits");

  // ---------- Summary ----------

  const roles = { teacher: 0, student: 0, child: 0, unknown: 0 };
  for (const r of names.values()) {
    const role = people.role(r.id);
    if (role in roles) roles[role as keyof typeof roles]++;
  }
  out(`
  Summary
    Tool calls:          ${runs.length} (${runs.filter((r) => r.ok).length} ok, ${runs.filter((r) => !r.ok).length} with error code)
    Error codes:         ${[...new Set(runs.filter((r) => r.code).map((r) => r.code))].join(", ") || "–"}
    Downloads tested:    ${fileRefs.size}
    Task details:        ${taskSample.length} tested, ${pageTasks} with text from the task page
    Names checked:       ${forbidden.size} terms from ${names.size} people (${ambiguous} ambiguous skipped)
    Roles detected:      ${roles.teacher} teachers, ${roles.student} students, ${roles.unknown} unknown${roles.child ? `, ${roles.child} children` : ""}
    Participant lists:   ${
      Object.entries(participantsStatus)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ") || "not checked"
    }
    Result:              ${leaks ? `❌ ${leaks} possible leak(s)` : "✅ no leaks found"}`);

  return { leaks, runs, participantsStatus };
}
