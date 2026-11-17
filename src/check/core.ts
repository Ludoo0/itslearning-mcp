/**
 * Compatibility check: can itslearning-mcp work with a given itslearning instance?
 *
 * Public checks (no credentials):
 *   reachable & itslearning · native login available (not SSO-only) · REST API present ·
 *   OAuth password grant with the mobile-app client accepted (tested with a random, non-existent user name)
 * Optional checks with credentials:
 *   login · token refresh · account type · core endpoints · course content · download path (SSO URL)
 *
 * Output contains status codes and counts only – never names or content – so it can be shared.
 */
import { detectLoginModeFromHtml } from "../auth/loginMode";
import { DEFAULT_CLIENT_ID } from "../config";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type CheckResult = { id: string; title: string; status: CheckStatus; detail: string };
export type Verdict = "compatible" | "partial" | "incompatible";
export type CheckReport = { baseUrl: string; results: CheckResult[]; verdict: Verdict; loginTested: boolean };

export type CheckOptions = {
  baseUrl: string;
  clientId?: string;
  credentials?: { username: string; password: string };
  fetchImpl?: typeof fetch;
  /** Called for every result as soon as it is known (for live CLI output). */
  onResult?: (r: CheckResult) => void;
  timeoutMs?: number;
};

const UA = "itslearning-mcp-check";
const P = "/restapi/personal";

type Json = Record<string, any>;

export async function runCheck(opts: CheckOptions): Promise<CheckReport> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl;
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const timeout = opts.timeoutMs ?? 15_000;
  const results: CheckResult[] = [];
  const add = (id: string, title: string, status: CheckStatus, detail: string) => {
    const r = { id, title, status, detail };
    results.push(r);
    opts.onResult?.(r);
    return r;
  };
  const finish = (loginTested: boolean): CheckReport => ({ baseUrl: base, results, verdict: verdictOf(results), loginTested });

  const get = (path: string, headers: Record<string, string> = {}) =>
    f(path.startsWith("http") ? path : base + path, { headers: { "User-Agent": UA, Accept: "application/json, text/html", ...headers }, signal: AbortSignal.timeout(timeout) });
  const token = async (params: Record<string, string>) => {
    const res = await f(`${base}/restapi/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
      body: new URLSearchParams({ client_id: clientId, ...params }),
      signal: AbortSignal.timeout(timeout),
    });
    let json: Json = {};
    try {
      json = (await res.json()) as Json;
    } catch {}
    return { status: res.status, json };
  };

  // ---------- 1. Reachable & itslearning ----------
  let html: string;
  try {
    const res = await get("/");
    html = await res.text();
    if (!res.ok) {
      add("reachable", "Instance reachable", "fail", `HTTP ${res.status} for the start page`);
      return finish(false);
    }
  } catch (e) {
    add("reachable", "Instance reachable", "fail", `not reachable (${e instanceof Error ? e.name : "error"})`);
    return finish(false);
  }
  if (!/itslearning/i.test(html)) {
    add("reachable", "Instance reachable", "fail", "the page does not look like an itslearning instance");
    return finish(false);
  }
  add("reachable", "Instance reachable", "ok", "itslearning start page found");

  // ---------- 2. Login method ----------
  const mode = detectLoginModeFromHtml(html);
  if (mode === "native") add("login-mode", "Native login (user name + password)", "ok", "available on the login page");
  else if (mode === "federated-only")
    add("login-mode", "Native login (user name + password)", "fail", "only single sign-on via an external identity provider – not supported (yet)");
  else add("login-mode", "Native login (user name + password)", "warn", "could not detect the login method from the start page");

  // ---------- 3. REST API ----------
  try {
    const res = await get(`${P}/person/v1`);
    await res.body?.cancel().catch(() => {});
    if (res.status === 401) add("rest-api", "REST API", "ok", "present (401 without token, as expected)");
    else if (res.status === 404) add("rest-api", "REST API", "fail", "not found (404)");
    else add("rest-api", "REST API", "warn", `unexpected HTTP ${res.status} without token`);
  } catch (e) {
    add("rest-api", "REST API", "fail", `not reachable (${e instanceof Error ? e.name : "error"})`);
  }

  // ---------- 4. OAuth password grant (mobile-app client) ----------
  try {
    const dummyUser = `itslearning-mcp-check-${crypto.randomUUID().slice(0, 8)}`;
    const r = await token({ grant_type: "password", username: dummyUser, password: crypto.randomUUID() });
    const code = String(r.json.ErrorCode ?? r.json.error ?? "");
    if (r.status === 401 && /InvalidUser/i.test(code)) {
      add("oauth", "Login via mobile-app API", "ok", "password login is accepted (tested with a non-existent user name)");
    } else if (/customer does not exist|disabled/i.test(code)) {
      add("oauth", "Login via mobile-app API", "fail", "instance not found or disabled – check the URL");
    } else if (/invalid_client|unauthorized_client|unsupported_grant_type/i.test(code)) {
      add("oauth", "Login via mobile-app API", "fail", `the mobile-app login is not accepted (${code})`);
    } else {
      add("oauth", "Login via mobile-app API", "warn", `unexpected answer (HTTP ${r.status}${code ? `, ${code}` : ""})`);
    }
  } catch (e) {
    add("oauth", "Login via mobile-app API", "fail", `token endpoint not reachable (${e instanceof Error ? e.name : "error"})`);
  }

  if (!opts.credentials) return finish(false);

  // Never send real credentials to an instance that failed the public checks or is not an itslearning host
  if (results.some((r) => r.status === "fail")) {
    add("login", "Login with your account", "skip", "skipped – the public checks failed, credentials were not sent");
    return finish(false);
  }
  if (!isItslearningHost(base)) {
    add("login", "Login with your account", "skip", "skipped – not an *.itslearning.com host, credentials were not sent");
    return finish(false);
  }

  // ---------- 5. Login with credentials ----------
  const login = await token({ grant_type: "password", username: opts.credentials.username, password: opts.credentials.password }).catch(() => undefined);
  if (!login?.json.access_token) {
    const code = String(login?.json.ErrorCode ?? login?.json.error ?? "");
    add("login", "Login with your account", "fail", /InvalidUser/i.test(code) ? "wrong user name or password" : `login failed (HTTP ${login?.status ?? "–"}${code ? `, ${code}` : ""})`);
    return finish(true);
  }
  add("login", "Login with your account", "ok", `access token valid for ${login.json.expires_in ?? "?"} s`);
  let access = String(login.json.access_token);

  // ---------- 6. Token refresh ----------
  if (login.json.refresh_token) {
    const r = await token({ grant_type: "refresh_token", refresh_token: String(login.json.refresh_token) }).catch(() => undefined);
    if (r?.json.access_token) {
      access = String(r.json.access_token);
      add("refresh", "Token refresh", "ok", r.json.refresh_token !== login.json.refresh_token ? "works (refresh token rotates)" : "works");
    } else {
      add("refresh", "Token refresh", "warn", "failed – the server would log in with the password again every few minutes");
    }
  } else {
    add("refresh", "Token refresh", "warn", "no refresh token issued – the server would log in with the password again every few minutes");
  }

  const api = async (path: string): Promise<{ status: number; json?: Json }> => {
    try {
      const res = await get(path, { Authorization: `Bearer ${access}`, Accept: "application/json" });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { status: res.status };
      }
      return { status: res.status, json: (await res.json()) as Json };
    } catch {
      return { status: 0 };
    }
  };
  const list = (j?: Json): Json[] => {
    if (!j) return [];
    if (Array.isArray(j.EntityArray)) return j.EntityArray;
    for (const v of Object.values(j)) if (v && Array.isArray((v as Json).EntityArray)) return (v as Json).EntityArray;
    return [];
  };

  // ---------- 7. Account type ----------
  const person = await api(`${P}/person/v1`);
  if (!person.json) {
    add("account", "Account type", "fail", `person endpoint failed (HTTP ${person.status})`);
  } else if (Array.isArray(person.json.Children) && person.json.Children.length > 0) {
    add("account", "Account type", "warn", "parent account – not supported yet; most tools will return little or nothing");
  } else if (person.json.CanAccessCourses === false) {
    add("account", "Account type", "warn", "the account has no access to courses");
  } else {
    add("account", "Account type", "ok", "student account");
  }

  // ---------- 8. Core endpoints ----------
  const endpoints: [string, string, string][] = [
    ["courses", "Courses", `${P}/courses/v1?PageIndex=0&PageSize=100`],
    ["tasks", "Tasks", `${P}/tasks/v1?PageIndex=0&PageSize=100`],
    ["news", "News feed", `${P}/notifications/stream/v2?showLightBulletins=true&PageIndex=0&PageSize=50`],
    ["messages", "Messages", `${P}/instantmessages/messagethreads/v4?pageSize=50`],
  ];
  let courses: Json[] = [];
  for (const [id, title, path] of endpoints) {
    const r = await api(path);
    if (!r.json) {
      add(id, title, id === "messages" ? "warn" : "fail", `HTTP ${r.status || "error"}${id === "messages" ? " – message tools will not work" : ""}`);
      continue;
    }
    const items = list(r.json);
    if (id === "courses") courses = items;
    add(id, title, "ok", `${items.length} item(s)`);
  }

  // ---------- 9. Course content ----------
  const course = courses.find((c) => typeof c.CourseId === "number");
  let fileElement: Json | undefined;
  if (!course) {
    add("course-files", "Course files", "skip", "no course to test with");
    add("participants", "Course participants (for redaction)", "skip", "no course to test with");
  } else {
    const res = await api(`${P}/courses/${course.CourseId}/resources/v1?PageIndex=0&PageSize=100`);
    if (res.json) {
      const items = list(res.json);
      fileElement = items.find((i) => !/folder/i.test(String(i.ElementType ?? "")) && (i.ContentUrl || i.Url));
      add("course-files", "Course files", "ok", `${items.length} item(s) in the first course's root folder`);
    } else {
      add("course-files", "Course files", "fail", `HTTP ${res.status || "error"}`);
    }
    const parts = await api(`${P}/courses/${course.CourseId}/participants/v1?PageIndex=0&PageSize=100`);
    if (parts.json) add("participants", "Course participants (for redaction)", "ok", `${list(parts.json).length} participant(s) readable`);
    else add("participants", "Course participants (for redaction)", "warn", `not readable (HTTP ${parts.status || "error"}) – names in course content are only redacted if seen elsewhere`);
  }

  // ---------- 10. Download path ----------
  if (!fileElement) {
    add("downloads", "File download path (web session)", "skip", "no course element to test with");
  } else {
    const target = String(fileElement.ContentUrl || fileElement.Url);
    const r = await api(`${P}/sso/url/v1?url=${encodeURIComponent(target)}`);
    if (r.json?.Url) add("downloads", "File download path (web session)", "ok", "single sign-on URL for the web interface is issued");
    else add("downloads", "File download path (web session)", "warn", `no SSO URL (HTTP ${r.status || "error"}) – course file downloads will not work`);
  }

  return finish(true);
}

export function isItslearningHost(baseUrl: string): boolean {
  try {
    return /(^|\.)itslearning\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function verdictOf(results: CheckResult[]): Verdict {
  if (results.some((r) => r.status === "fail")) return "incompatible";
  if (results.some((r) => r.status === "warn")) return "partial";
  return "compatible";
}
