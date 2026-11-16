/**
 * itslearning API probe – Runde 2
 *
 * Testet gezielt: Token-Refresh, Kalender, Kurs-Inhalte (News, Stream, Ressourcen),
 * Aufgaben-Details inkl. Anhänge, Nachrichten-Threads und den Datei-Download
 * (über SSO-URL → Web-Session → Download-Link).
 *
 * Ergebnis: probe-output/report2.json – REDACTED, d. h. nur Struktur:
 *   Feldnamen + Typen, Anzahl, HTTP-Status, URL-Muster (IDs/Tokens/Dateinamen ersetzt)
 *   und Werte einiger Enum-Felder (ElementType, Status …). Keine Namen, keine Texte.
 *
 * Ausführen:   bun run probe2           (nur redacted Report)
 *              bun run probe2 --save    (zusätzlich Rohdaten nach probe-output/raw2/ – privat!)
 */

import { BASE, UA, ItslearningClient, loginWithPassword, refreshToken, promptCredentials } from "./lib";

const SAVE = process.argv.includes("--save");
const OUT = "probe-output";
const RAW = `${OUT}/raw2`;
const DELAY_MS = 300;
const DEEP_COURSES = 3;
const MAX_DOWNLOADS = 3;

type Json = any;

// =====================================================================
// Redaction
// =====================================================================

/** Felder, deren Werte unkritische Kategorien sind und im Report bleiben dürfen. */
const ENUM_FIELDS = new Set([
  "ElementType", "Status", "Type", "LearningToolType", "CourseFocus", "ContextRole",
  "NotificationType", "ContentType", "TaskStatus", "AssessmentType", "FeatureType",
  "EventType", "ThreadType", "MessageType", "FileType", "SubmissionStatus",
]);

/** Feldnamen, die direkt auf Personen verweisen. */
const PERSON_RE =
  /(FirstName|LastName|FullName|DisplayName|^Name$|PersonId|PersonName|Person$|ProfileImage|ProfileUrl|PictureUrl|Avatar|PublishedBy|CreatedBy|ChangedBy|UpdatedBy|Author|Email|Mail|Participant|Sender|Recipient|Phone|Member|Student|Teacher|Owner|User)/i;
/** Feldnamen mit Freitext, in dem Namen u. ä. stehen können. */
const FREETEXT_RE = /(Text|Body|Message|Comment|Description|Content$|Html|Lexical|Summary|Title|Subject)/i;

type Ctx = { enums: Map<string, Set<string>>; urls: Map<string, Set<string>> };
const newCtx = (): Ctx => ({ enums: new Map(), urls: new Map() });

function addTo(map: Map<string, Set<string>>, key: string, value: string, limit = 15) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  if (set.size < limit) set.add(value);
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function redactSegment(seg: string): string {
  if (!seg) return seg;
  const s = safeDecode(seg);
  if (/^\d+$/.test(s)) return "{n}";
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s)) return "{guid}";
  if (/^[\w-]+\.(aspx|ashx|asmx|html?|php)$/i.test(s)) return s; // Seitennamen behalten
  const ext = s.match(/\.([a-z0-9]{1,5})$/i);
  if (ext) return `{file}.${ext[1]!.toLowerCase()}`;
  // Lange, ungewöhnliche oder gemischt alphanumerische Segmente (Short-Links, Tokens) entfernen
  if (s.length > 24 || /[^\w.-]/.test(s) || (/\d/.test(s) && /[a-z]/i.test(s))) return "{token}";
  return s;
}

/** Ersetzt IDs, Tokens, Dateinamen und alle Query-Werte. Host + Pfadstruktur bleiben.
 *  Externe (nicht-itslearning) URLs werden komplett ersetzt – sie stammen meist aus Inhalten. */
function redactUrl(raw: string, base = BASE): string {
  let u: URL;
  try {
    u = new URL(raw.replace(/^webcal:/i, "https:"), base);
  } catch {
    return "{unparseable}";
  }
  if (u.protocol === "data:") return "data:{…}";
  if (!/(^|\.)itslearning\.com$/i.test(u.hostname)) return "{external-url}";
  const path = u.pathname.split("/").map(redactSegment).join("/");
  const keys = [...new Set(u.searchParams.keys())];
  const qs = keys.length
    ? "?" + keys.map((k) => `${k}={${/^\d+$/.test(u.searchParams.get(k) ?? "") ? "n" : "v"}}`).join("&")
    : "";
  return `${u.protocol}//${u.host}${path}${qs}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeSchemas(a: Json, b: Json): Json {
  if (a === undefined || a === "null") return b;
  if (b === undefined || b === "null") return a;
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, Json> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = mergeSchemas(out[k], v);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length ? (b.length ? [mergeSchemas(a[0], b[0])] : a) : b;
  return a;
}

/** Wandelt beliebiges JSON in ein Schema (nur Typen) um und sammelt Enums + URL-Muster. */
function schemaOf(v: unknown, ctx: Ctx, key = "", depth = 0): Json {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    let merged: Json;
    for (const item of v.slice(0, 10)) merged = mergeSchemas(merged, schemaOf(item, ctx, key, depth + 1));
    return [merged];
  }
  if (typeof v === "object") {
    if (depth > 8) return "object(…)";
    const out: Record<string, Json> = {};
    for (const [k, val] of Object.entries(v)) out[k] = schemaOf(val, ctx, k, depth + 1);
    return out;
  }
  if (typeof v === "string") {
    if (ENUM_FIELDS.has(key) && v.length <= 40 && !v.includes("@")) addTo(ctx.enums, key, v);
    if (/^(https?:|webcal:)?\/\//i.test(v) || /^\/[\w-]+\//.test(v)) {
      // URL-Muster nur aus echten URL-Feldern sammeln, nie aus Freitext (z. B. Nachrichtentext)
      if (!FREETEXT_RE.test(key) || /Url$/i.test(key)) addTo(ctx.urls, key, redactUrl(v), 8);
      return "url";
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "datetime";
    if (/<[a-z][^>]*>/i.test(v)) return "html";
    return v.length ? "string" : "string(empty)";
  }
  if (typeof v === "number") {
    if (ENUM_FIELDS.has(key)) addTo(ctx.enums, key, String(v));
    return "number";
  }
  return typeof v;
}

/** Listet alle Pfade im Schema, deren Feldname personenbezogen bzw. Freitext ist. */
function sensitivePaths(schema: Json, prefix = ""): { person: string[]; freetext: string[] } {
  const res = { person: [] as string[], freetext: [] as string[] };
  const walk = (s: Json, p: string): void => {
    if (Array.isArray(s)) {
      if (s[0] !== undefined) walk(s[0], `${p}[]`);
      return;
    }
    if (!isPlainObject(s)) return;
    for (const [k, v] of Object.entries(s)) {
      const path = p ? `${p}.${k}` : k;
      if (PERSON_RE.test(k)) res.person.push(path);
      else if (FREETEXT_RE.test(k) && (v === "string" || v === "html")) res.freetext.push(path);
      walk(v, path);
    }
  };
  walk(schema, prefix);
  return res;
}

const toRecord = (m: Map<string, Set<string>>) =>
  m.size ? Object.fromEntries([...m].map(([k, s]) => [k, [...s]])) : undefined;

function sanitizeError(text: string): string {
  if (/<html|<!DOCTYPE/i.test(text)) return "HTML-Fehlerseite";
  return text
    .replace(/(https?|webcal):\/\/[^\s'"]+/gi, (u) => redactUrl(u))
    .replace(/\d+/g, "{n}") // IDs (PersonId, CourseId …) aus Fehlermeldungen entfernen
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

const uniq = <T,>(a: T[]) => [...new Set(a)];
const slug = (s: string) => s.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").slice(0, 60);
/** Liste aus Antwort holen: Array, {EntityArray} oder eine Ebene verschachtelt ({Resources:{EntityArray}}). */
const entities = (j: Json): Json[] => {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.EntityArray)) return j.EntityArray;
  if (isPlainObject(j)) for (const v of Object.values(j)) if (Array.isArray((v as Json)?.EntityArray)) return (v as Json).EntityArray;
  return [];
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Ersetzt {platzhalter} im Template durch URL-encodete Werte. */
function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(params[k] ?? "")));
}

/** Sucht rekursiv ein Feld (erste Übereinstimmung) */
function findKey(obj: Json, re: RegExp): string | undefined {
  return isPlainObject(obj) ? Object.keys(obj).find((k) => re.test(k)) : undefined;
}

/** Sammelt rekursiv alle Objekte, die ein Feld passend zu `re` haben. */
function collectObjectsWithKey(v: Json, re: RegExp, out: Json[] = [], depth = 0): Json[] {
  if (depth > 8 || v === null || typeof v !== "object") return out;
  if (Array.isArray(v)) v.forEach((x) => collectObjectsWithKey(x, re, out, depth + 1));
  else {
    if (Object.keys(v).some((k) => re.test(k))) out.push(v);
    Object.values(v).forEach((x) => collectObjectsWithKey(x, re, out, depth + 1));
  }
  return out;
}

// =====================================================================
// Report
// =====================================================================

type StepResult = {
  step: string;
  endpoint: string;
  status: number | string;
  ms?: number;
  count?: number;
  total?: number;
  error?: string;
  schema?: Json;
  enums?: Record<string, string[]>;
  urlPatterns?: Record<string, string[]>;
  sensitive?: { person: string[]; freetext: string[] };
  [extra: string]: unknown;
};

const steps: StepResult[] = [];
const findings: string[] = [];

function logStep(r: StepResult) {
  const ok = typeof r.status === "number" && r.status >= 200 && r.status < 300;
  const n = r.count !== undefined ? ` · ${r.count}${r.total !== undefined ? `/${r.total}` : ""} Einträge` : "";
  console.log(`${ok ? "✅" : "❌"} ${String(r.status).padEnd(4)} ${r.step}${n}`);
  console.log(`         ${r.endpoint}${r.error ? `\n         → ${r.error}` : ""}`);
}

let client: ItslearningClient;

/** GET + Schema-Analyse + optional Rohdaten speichern. Gibt JSON bei Erfolg zurück. */
async function call(step: string, template: string, params: Record<string, string | number> = {}): Promise<Json | undefined> {
  const path = fill(template, params);
  const t0 = performance.now();
  const r: StepResult = { step, endpoint: template, status: "?" };
  let json: Json;
  try {
    const res = await client.get(path);
    const text = await res.text();
    r.status = res.status;
    r.ms = Math.round(performance.now() - t0);
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    if (res.ok && json !== undefined) {
      const ctx = newCtx();
      r.schema = schemaOf(json, ctx);
      if (Array.isArray(json?.EntityArray)) {
        r.count = json.EntityArray.length;
        r.total = json.Total;
      } else if (Array.isArray(json)) r.count = json.length;
      r.enums = toRecord(ctx.enums);
      r.urlPatterns = toRecord(ctx.urls);
      const sens = sensitivePaths(r.schema);
      if (sens.person.length || sens.freetext.length) r.sensitive = sens;
      if (SAVE) await Bun.write(`${RAW}/${slug(step)}.json`, JSON.stringify(json, null, 2));
    } else if (!res.ok) {
      r.error = sanitizeError(text);
    } else {
      r.error = `Kein JSON (${res.headers.get("content-type")}, ${text.length} Bytes)`;
    }
  } catch (e) {
    r.status = "network-error";
    r.error = e instanceof Error ? e.message : String(e);
  }
  steps.push(r);
  logStep(r);
  await Bun.sleep(DELAY_MS);
  return typeof r.status === "number" && r.status < 300 ? json : undefined;
}

// =====================================================================
// Web-Session (für Datei-Downloads über SSO-URL)
// =====================================================================

class CookieJar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(";")[0] ?? "";
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const isItslHost = (url: string) => /(^|\.)itslearning\.com$/i.test(new URL(url).hostname);

/** Folgt Redirects manuell und hält Cookies (nur für *.itslearning.com). */
async function browse(url: string, jar: CookieJar, maxHops = 12) {
  const hops: { status: number; url: string }[] = [];
  let current = url;
  let res!: Response;
  for (let i = 0; i < maxHops; i++) {
    const headers: Record<string, string> = { "User-Agent": UA };
    const cookie = jar.header();
    if (isItslHost(current) && cookie) headers.Cookie = cookie;
    res = await fetch(current, { redirect: "manual", headers });
    if (isItslHost(current)) jar.store(res);
    hops.push({ status: res.status, url: redactUrl(current) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }
  return { res, hops, finalUrl: current };
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

const DOWNLOAD_RE =
  /download|file\.aspx|\/file\/|getfile|filerepository|\.(pdf|docx?|xlsx?|pptx?|od[tsp]|zip|jpe?g|png|gif|mp[34]|txt|rtf)(\?|$)/i;

function extractLinks(html: string, baseUrl: string) {
  const iframes: string[] = [];
  const downloads: string[] = [];
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    try {
      iframes.push(new URL(decodeHtml(m[1]!), baseUrl).toString());
    } catch {}
  }
  for (const m of html.matchAll(/(?:href|src|data-[\w-]+)=["']([^"']+)["']/gi)) {
    const raw = decodeHtml(m[1]!);
    if (!DOWNLOAD_RE.test(raw) || /\.(css|js)(\?|$)|cdn\.itslearning\.com/i.test(raw)) continue;
    try {
      downloads.push(new URL(raw, baseUrl).toString());
    } catch {}
  }
  return { iframes: uniq(iframes), downloads: uniq(downloads) };
}

function describeFile(res: Response, bytes: number) {
  const cd = res.headers.get("content-disposition") ?? "";
  const ext = cd.match(/filename\*?=(?:UTF-8'')?"?[^";]*?\.([a-z0-9]{1,5})"?(;|$)/i)?.[1];
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentDisposition: cd ? cd.split(";")[0] : null,
    fileExtension: ext?.toLowerCase() ?? null,
    bytes,
  };
}

/** Lädt eine (vermutlich tokenisierte) Datei-URL direkt; bei Fehler zweiter Versuch mit Bearer-Token. */
async function probeDirectFile(step: string, url: string) {
  const r: StepResult = { step, endpoint: redactUrl(url), status: "?" };
  try {
    const dl = await browse(url, new CookieJar());
    let buf = await dl.res.arrayBuffer();
    r.hops = dl.hops;
    r.status = dl.res.status;
    r.download = describeFile(dl.res, buf.byteLength);
    r.authNeeded = false;
    if (!dl.res.ok) {
      const res2 = await client.get(url);
      buf = await res2.arrayBuffer();
      r.status = res2.status;
      r.download = describeFile(res2, buf.byteLength);
      r.authNeeded = res2.ok ? "bearer" : "unknown";
    }
    if (SAVE && typeof r.status === "number" && r.status < 300) {
      await Bun.write(`${RAW}/${slug(step)}.${(r.download as any).fileExtension ?? "bin"}`, buf);
    }
  } catch (e) {
    r.status = "error";
    r.error = sanitizeError(e instanceof Error ? e.message : String(e));
  }
  steps.push(r);
  logStep(r);
  const dl = r.download as any;
  if (dl) console.log(`         → Datei: ${dl.contentType} · ${dl.bytes} Bytes · .${dl.fileExtension ?? "?"}`);
  await Bun.sleep(DELAY_MS);
}

/** Versucht, eine Kurs-Ressource über SSO-URL + Web-Session herunterzuladen. */
async function probeResourceDownload(resource: Json, idx: number) {
  const elementType = String(resource.ElementType ?? "?");
  const detail = await call(`Ressource-Detail #${idx} (${elementType})`, "/restapi/personal/courses/resources/{resourceId}/v1", {
    resourceId: resource.ElementId,
  });
  const target: string | undefined = detail?.ContentUrl || detail?.Url || resource.ContentUrl || resource.Url;
  if (!target) return;
  const sso = await call(`SSO-URL #${idx}`, "/restapi/personal/sso/url/v1?url={url}", { url: target });
  if (!sso?.Url) return;

  const rec: StepResult = { step: `Download-Flow #${idx} (${elementType})`, endpoint: "SSO-URL → Web-Session", status: "?" };
  try {
    const jar = new CookieJar();
    const page = await browse(sso.Url, jar);
    rec.hops = page.hops;
    rec.status = page.res.status;
    const ct = page.res.headers.get("content-type") ?? "";
    rec.finalContentType = ct;

    let candidate: string | undefined;
    if (ct.includes("text/html")) {
      const html = await page.res.text();
      if (SAVE) await Bun.write(`${RAW}/download-${idx}-page.html`, html);
      const links = extractLinks(html, page.finalUrl);
      rec.pageLooksLikeLogin = /ctl00_ContentPlaceHolder1_(nativeLogin|Username)/.test(html);
      rec.downloadLinkPatterns = uniq(links.downloads.map((u) => redactUrl(u))).slice(0, 10);
      rec.iframePatterns = uniq(links.iframes.map((u) => redactUrl(u))).slice(0, 5);
      candidate = links.downloads[0];

      // Viele Element-Seiten betten den Inhalt per iframe ein → eine Ebene tiefer schauen
      if (!candidate && links.iframes[0]) {
        const inner = await browse(links.iframes[0], jar);
        const innerCt = inner.res.headers.get("content-type") ?? "";
        const iframe: Record<string, unknown> = { hops: inner.hops, contentType: innerCt };
        if (innerCt.includes("text/html")) {
          const innerHtml = await inner.res.text();
          if (SAVE) await Bun.write(`${RAW}/download-${idx}-iframe.html`, innerHtml);
          const innerLinks = extractLinks(innerHtml, inner.finalUrl);
          iframe.downloadLinkPatterns = uniq(innerLinks.downloads.map((u) => redactUrl(u))).slice(0, 10);
          iframe.iframePatterns = uniq(innerLinks.iframes.map((u) => redactUrl(u))).slice(0, 5);
          candidate = innerLinks.downloads[0];
        } else {
          const buf = await inner.res.arrayBuffer();
          iframe.file = describeFile(inner.res, buf.byteLength);
        }
        rec.iframe = iframe;
      }
    } else {
      const buf = await page.res.arrayBuffer();
      rec.download = describeFile(page.res, buf.byteLength);
    }

    if (candidate) {
      const dl = await browse(candidate, jar);
      const buf = await dl.res.arrayBuffer();
      rec.download = { hops: dl.hops, ...describeFile(dl.res, buf.byteLength) };
      if (SAVE) {
        const ext = (rec.download as any).fileExtension ?? "bin";
        await Bun.write(`${RAW}/download-${idx}.${ext}`, buf);
      }
    }
  } catch (e) {
    rec.status = "error";
    rec.error = e instanceof Error ? e.message : String(e);
  }
  steps.push(rec);
  logStep(rec);
  const dl = rec.download as any;
  if (dl) console.log(`         → Datei: ${dl.contentType} · ${dl.bytes} Bytes · .${dl.fileExtension ?? "?"}`);
  await Bun.sleep(DELAY_MS);
}

// =====================================================================
// Main
// =====================================================================

async function main() {
  const { username, password } = await promptCredentials();
  console.log(`\nitslearning API probe – Runde 2 → ${BASE}`);

  // --- 1. Auth + Refresh ---
  process.stdout.write("\nLogin … ");
  const first = await loginWithPassword(username, password);
  console.log(`OK (expires_in=${first.expires_in}s)`);
  const auth: Record<string, unknown> = { expiresIn: first.expires_in, tokenType: first.token_type, hasRefreshToken: !!first.refresh_token };
  let token = first;
  if (first.refresh_token) {
    try {
      const refreshed = await refreshToken(first.refresh_token);
      auth.refreshWorks = true;
      auth.refreshRotatesRefreshToken = refreshed.refresh_token !== first.refresh_token;
      auth.refreshedExpiresIn = refreshed.expires_in;
      token = refreshed;
      console.log(`Refresh … OK (rotiert: ${auth.refreshRotatesRefreshToken ? "ja" : "nein"})\n`);
    } catch (e) {
      auth.refreshWorks = false;
      auth.refreshError = e instanceof Error ? e.message : String(e);
      console.log(`Refresh … FEHLER: ${auth.refreshError}\n`);
    }
  }
  client = new ItslearningClient(token);

  // --- 2. Person + Kalender ---
  console.log("── Person & Kalender");
  const person = await call("Person", "/restapi/personal/person/v1");
  const from = new Date(Date.now() - 7 * 864e5);
  await call("Kalender-Events ab -7 Tage", "/restapi/personal/calendar/events/v1?fromDate={from}&PageSize=50", { from: isoDate(from) });

  if (person?.iCalUrl) {
    const r: StepResult = { step: "iCal-Feed", endpoint: redactUrl(person.iCalUrl), status: "?" };
    try {
      const res = await fetch(String(person.iCalUrl).replace(/^webcal:/i, "https:"), { headers: { "User-Agent": UA } });
      const text = await res.text();
      r.status = res.status;
      r.contentType = res.headers.get("content-type");
      r.count = (text.match(/BEGIN:VEVENT/g) ?? []).length;
      r.icalProperties = uniq([...text.matchAll(/^([A-Z-]+)[;:]/gm)].map((m) => m[1]!)).sort();
      if (SAVE) await Bun.write(`${RAW}/ical.ics`, text);
    } catch (e) {
      r.status = "error";
      r.error = String(e);
    }
    steps.push(r);
    logStep(r);
  }

  // --- 3. Kurse ---
  console.log("\n── Kurse");
  const v1 = entities(await call("Kurse v1", "/restapi/personal/courses/v1?PageSize=100"));
  const v2 = entities(await call("Kurse v2", "/restapi/personal/courses/v2?PageSize=100"));
  await call("Kurse v3", "/restapi/personal/courses/v3?PageSize=100");
  await call("Kurse v4", "/restapi/personal/courses/v4?PageSize=100");
  await call("Kurs-Karten (starred)", "/restapi/personal/courses/cards/starred/v1?PageSize=100");

  const cid = (c: Json) => c?.CourseId ?? c?.Id;
  const v1Ids = new Set(v1.map(cid));
  const onlyV2 = v2.filter((c) => !v1Ids.has(cid(c)));
  findings.push(`Kurse: v1=${v1.length}, v2=${v2.length}, nur in v2=${onlyV2.length}`);
  if (onlyV2.length) {
    // Welche Feldwerte unterscheiden die "nur v2"-Kurse? (nur boolesche Felder + Enums, keine Titel)
    const boolDiff: Record<string, { onlyV2True: number; v1True: number }> = {};
    for (const k of Object.keys(v2[0] ?? {})) {
      if (typeof v2[0][k] !== "boolean") continue;
      boolDiff[k] = {
        onlyV2True: onlyV2.filter((c) => c[k] === true).length,
        v1True: v2.filter((c) => v1Ids.has(cid(c)) && c[k] === true).length,
      };
    }
    steps.push({ step: "Kurse v1 vs v2 (boolesche Felder)", endpoint: "-", status: "analysis", boolDiff });
  }

  // --- 4. Kurs-Tiefenprobe ---
  const deepCourses = [...v1]
    .sort((a, b) => String(b.LastUpdatedUtc ?? "").localeCompare(String(a.LastUpdatedUtc ?? "")))
    .slice(0, DEEP_COURSES);
  const resourcePool: Json[] = [];
  const bulletinIds: number[] = [];
  const bulletinImageUrls: string[] = [];

  for (const [i, c] of deepCourses.entries()) {
    const courseId = cid(c);
    const tag = `Kurs ${i + 1}`;
    console.log(`\n── ${tag} (zuletzt aktualisiert)`);
    await call(`${tag}: Details`, "/restapi/personal/courses/{courseId}/v1", { courseId });
    await call(`${tag}: Features v2`, "/restapi/personal/courses/{courseId}/features/v2", { courseId });
    const bulletins = await call(`${tag}: Bulletins`, "/restapi/personal/courses/{courseId}/bulletins/v1?PageSize=10", { courseId });
    for (const b of entities(bulletins)) {
      const k = findKey(b, /BulletinId$/i);
      if (k && b[k]) bulletinIds.push(b[k]);
      for (const img of b.AttachedImages ?? []) if (img?.OriginalFileUrl) bulletinImageUrls.push(img.OriginalFileUrl);
    }
    await call(`${tag}: Stream (inkl. Light Bulletins)`, "/restapi/personal/courses/{courseId}/stream/v1?showLightBulletins=true&PageSize=20", { courseId });
    await call(`${tag}: Aufgaben`, "/restapi/personal/courses/{courseId}/tasks/v1?PageSize=20", { courseId });
    await call(`${tag}: Kalender`, "/restapi/personal/courses/{courseId}/calendarevents/v1?PageSize=20&fromDate={from}", { courseId, from: isoDate(from) });
    await call(`${tag}: Zuletzt geänderte Ressourcen`, "/restapi/personal/courses/{courseId}/resources/lastupdated/v1?numberOfElements=10", { courseId });
    const root = entities(await call(`${tag}: Ressourcen (Root)`, "/restapi/personal/courses/{courseId}/resources/v1?PageSize=100", { courseId }));
    const isFolder = (r: Json) => /folder/i.test(String(r.ElementType));
    resourcePool.push(...root.filter((r) => !isFolder(r)));
    const folder = root.find(isFolder);
    if (folder) {
      const sub = entities(
        await call(`${tag}: Ressourcen (Unterordner)`, "/restapi/personal/courses/{courseId}/folders/{folderId}/resources/v1?PageSize=100", {
          courseId,
          folderId: folder.ElementId,
        }),
      );
      resourcePool.push(...sub.filter((r) => !isFolder(r)));
    }
  }

  if (bulletinIds.length) {
    console.log("\n── Bulletin-Anhänge");
    await call("Bulletin: Elemente/Anhänge", "/restapi/personal/courses/bulletins/{bulletinId}/elements/v1", { bulletinId: bulletinIds[0]! });
  }

  // --- 5. Aufgaben global + Details ---
  console.log("\n── Aufgaben");
  const tasks = entities(await call("Aufgaben (alle)", "/restapi/personal/tasks/v1?PageSize=100"));
  await call("Aufgaben-Tagesübersicht", "/restapi/personal/tasklistdailyworkflow/v1?PageSize=50");
  let assignmentFileTested = false;
  for (const [i, t] of tasks.slice(0, 3).entries()) {
    const elementId = t.ElementId ?? t.TaskId;
    if (!elementId) continue;
    const a = await call(`Assignment-Detail #${i + 1} (${t.ElementType ?? "?"})`, "/restapi/personal/assignments/{elementId}/v1", { elementId });
    if (!a || assignmentFileTested) continue;
    const fileObj = collectObjectsWithKey(a, /^FileId$/i)[0];
    if (!fileObj) continue;
    assignmentFileTested = true;
    const r: StepResult = { step: "Assignment-Datei-Download", endpoint: "/restapi/personal/assignments/{elementId}/files/{fileId}/v1", status: "?" };
    try {
      const res = await client.get(fill("/restapi/personal/assignments/{elementId}/files/{fileId}/v1", { elementId, fileId: fileObj.FileId }), {
        redirect: "manual",
      });
      r.status = res.status;
      const loc = res.headers.get("location");
      r.redirectPattern = loc ? redactUrl(loc) : null;
      if (loc) {
        const dl = await browse(new URL(loc, BASE).toString(), new CookieJar());
        const buf = await dl.res.arrayBuffer();
        r.download = { hops: dl.hops, ...describeFile(dl.res, buf.byteLength) };
        if (SAVE) await Bun.write(`${RAW}/assignment-file.${(r.download as any).fileExtension ?? "bin"}`, buf);
      }
    } catch (e) {
      r.status = "error";
      r.error = String(e);
    }
    steps.push(r);
    logStep(r);
  }
  if (!assignmentFileTested) findings.push("In den ersten 3 Aufgaben wurde keine Datei (FileId) gefunden.");

  // --- 6. Neuigkeiten ---
  console.log("\n── Neuigkeiten");
  const stream = entities(await call("Notification-Stream v2 (inkl. Light Bulletins)", "/restapi/personal/notifications/stream/v2?showLightBulletins=true&PageSize=30"));
  await call("Notifications v2", "/restapi/personal/notifications/v2?PageSize=20");
  await call("Newsfeed", "/restapi/personal/notifications/newsfeed/v1?PageSize=20");
  await call("Ungelesen-Zähler", "/restapi/personal/notifications/unread-count/v1");
  const notifId = stream.find((n) => n.NotificationId)?.NotificationId;
  if (notifId) await call("Notification: Elemente/Anhänge", "/restapi/personal/notifications/{notificationId}/elements/v1", { notificationId: notifId });

  // --- 7. Nachrichten ---
  console.log("\n── Nachrichten");
  const threads = entities(await call("Threads v4", "/restapi/personal/instantmessages/messagethreads/v4?pageSize=10"));
  await call("Ungelesene Nachrichten", "/restapi/personal/instantmessages/messagethreads/unread-count/v1");
  const threadId = threads[0]?.InstantMessageThreadId;
  if (threadId) {
    await call("Thread-Nachrichten v3", "/restapi/personal/instantmessages/messagethreads/{threadId}/messages/v3?pageSize=20", { threadId });
  }
  const attachmentUrl = collectObjectsWithKey(threads, /^AttachmentUrl$/)
    .map((m) => m.AttachmentUrl)
    .find((u) => typeof u === "string" && u.startsWith("http"));
  if (attachmentUrl) await probeDirectFile("Nachrichten-Anhang (direkt)", attachmentUrl);
  else findings.push("Kein Nachrichten-Anhang in den ersten 10 Threads gefunden.");
  if (bulletinImageUrls[0]) await probeDirectFile("Bulletin-Bild (direkt)", bulletinImageUrls[0]);

  // --- 8. Datei-Downloads ---
  console.log("\n── Datei-Downloads (Kurs-Ressourcen)");
  const typeCounts: Record<string, number> = {};
  for (const r of resourcePool) typeCounts[String(r.ElementType)] = (typeCounts[String(r.ElementType)] ?? 0) + 1;
  steps.push({ step: "Ressourcen-Typen (Stichprobe)", endpoint: "-", status: "analysis", typeCounts });
  // Pro ElementType höchstens ein Kandidat, Datei-ähnliche zuerst
  const byType = new Map<string, Json>();
  for (const r of resourcePool) if (!byType.has(String(r.ElementType))) byType.set(String(r.ElementType), r);
  const candidates = [...byType.values()]
    .sort((a, b) => Number(/file|document/i.test(String(b.ElementType))) - Number(/file|document/i.test(String(a.ElementType))))
    .slice(0, MAX_DOWNLOADS);
  if (!candidates.length) findings.push("Keine Ressourcen (außer Ordnern) in den Stichproben-Kursen gefunden.");
  for (const [i, r] of candidates.entries()) await probeResourceDownload(r, i + 1);

  // --- Report ---
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    redacted: true,
    note: "Nur Struktur: Feldnamen/Typen, Status, Anzahlen, URL-Muster und Enum-Werte. Keine Inhalte.",
    auth,
    findings,
    steps,
  };
  await Bun.write(`${OUT}/report2.json`, JSON.stringify(report, null, 2));

  const ok = steps.filter((s) => typeof s.status === "number" && s.status < 300).length;
  console.log(`\nFertig: ${ok}/${steps.length} Schritte erfolgreich.`);
  console.log(`Redacted Report: ${OUT}/report2.json  (enthält keine Inhalte – den kann Claude direkt lesen)`);
  if (SAVE) console.log(`Rohdaten: ${RAW}/  (PRIVAT – enthält personenbezogene Daten, nicht teilen!)`);
}

if (import.meta.main) main().catch((err) => {
  console.error(`\nFehler: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
export { redactUrl, schemaOf, sensitivePaths, newCtx, extractLinks };
