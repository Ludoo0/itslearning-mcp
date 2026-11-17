import { describe, expect, test } from "bun:test";
import { type CheckOptions, runCheck } from "../src/check/core";

/** Fake itslearning instance for the compatibility check (fictional data only). */
type Scenario = {
  startPage?: { status: number; body: string } | "network-error";
  personWithoutToken?: number;
  tokenError?: { status: number; body: Record<string, unknown> };
  validLogin?: { username: string; password: string };
  refreshWorks?: boolean;
  children?: unknown[];
  participantsStatus?: number;
  ssoUrl?: boolean;
};

const NATIVE_PAGE = '<html><title>itslearning</title><li id="ctl00_ContentPlaceHolder1_nativeLogin"></li></html>';
const SSO_PAGE = '<html><title>itslearning</title><div id="ctl00_ContentPlaceHolder1_federatedLogin"></div></html>';

function fakeInstance(s: Scenario = {}) {
  const requests: string[] = [];
  const paged = (items: unknown[]) => Response.json({ EntityArray: items, Total: items.length });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const authed = new Headers(init?.headers).get("authorization") === "Bearer A2" || new Headers(init?.headers).get("authorization") === "Bearer A1";

    if (url.pathname === "/") {
      const sp = s.startPage ?? { status: 200, body: NATIVE_PAGE };
      if (sp === "network-error") throw new TypeError("fetch failed");
      return new Response(sp.body, { status: sp.status, headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/restapi/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      if (p.get("grant_type") === "password") {
        if (s.validLogin && p.get("username") === s.validLogin.username && p.get("password") === s.validLogin.password) {
          return Response.json({ access_token: "A1", refresh_token: "R1", expires_in: 300 });
        }
        const e = s.tokenError ?? { status: 401, body: { ErrorCode: "InvalidUser" } };
        return Response.json(e.body, { status: e.status });
      }
      if (p.get("grant_type") === "refresh_token") {
        return s.refreshWorks === false ? Response.json({ error: "invalid_grant" }, { status: 400 }) : Response.json({ access_token: "A2", refresh_token: "R2", expires_in: 300 });
      }
    }
    if (url.pathname === "/restapi/personal/person/v1") {
      if (!authed) return new Response("", { status: s.personWithoutToken ?? 401 });
      return Response.json({ PersonId: 1, FirstName: "Testina", LastName: "Fakeperson", Children: s.children ?? [], CanAccessCourses: true });
    }
    if (!authed) return new Response("", { status: 401 });
    if (url.pathname === "/restapi/personal/courses/v1") return paged([{ CourseId: 11 }, { CourseId: 12 }]);
    if (url.pathname === "/restapi/personal/tasks/v1") return paged([{ TaskId: 1 }]);
    if (url.pathname === "/restapi/personal/notifications/stream/v2") return paged([]);
    if (url.pathname === "/restapi/personal/instantmessages/messagethreads/v4") return Response.json({ Threads: { EntityArray: [{}, {}], Total: 0 }, HasMore: false });
    if (url.pathname === "/restapi/personal/courses/11/resources/v1") {
      return Response.json({ Resources: { EntityArray: [{ ElementType: "Folder" }, { ElementType: "LearningToolElement", ContentUrl: "https://demo.itslearning.com/x" }] } });
    }
    if (url.pathname === "/restapi/personal/courses/11/participants/v1") {
      return s.participantsStatus ? new Response("", { status: s.participantsStatus }) : paged([{ PersonId: 1 }, { PersonId: 2 }, { PersonId: 3 }]);
    }
    if (url.pathname === "/restapi/personal/sso/url/v1") return s.ssoUrl === false ? new Response("", { status: 403 }) : Response.json({ Url: "https://demo.itslearning.com/sso?Signature=x" });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const check = (s: Scenario, extra: Partial<CheckOptions> = {}) => {
  const { fetchImpl, requests } = fakeInstance(s);
  return runCheck({ baseUrl: "https://demo.itslearning.com", fetchImpl, ...extra }).then((r) => ({ ...r, requests }));
};
const statusOf = (r: { results: { id: string; status: string }[] }, id: string) => r.results.find((x) => x.id === id)?.status;

describe("compatibility check – public", () => {
  test("native instance → compatible, 4 checks, login not tested", async () => {
    const r = await check({});
    expect(r.results.map((x) => [x.id, x.status])).toEqual([
      ["reachable", "ok"],
      ["login-mode", "ok"],
      ["rest-api", "ok"],
      ["oauth", "ok"],
    ]);
    expect(r).toMatchObject({ verdict: "compatible", loginTested: false });
    // the probe login uses a random, non-existent user name
    expect(r.requests.filter((x) => x === "POST /restapi/oauth2/token")).toHaveLength(1);
  });

  test("SSO-only instance → incompatible", async () => {
    const r = await check({ startPage: { status: 200, body: SSO_PAGE } });
    expect(statusOf(r, "login-mode")).toBe("fail");
    expect(r.verdict).toBe("incompatible");
  });

  test("unknown instance (customer does not exist) → incompatible", async () => {
    const r = await check({ tokenError: { status: 401, body: { ErrorCode: "Customer does not exist or is disabled" } } });
    expect(statusOf(r, "oauth")).toBe("fail");
    expect(r.results.find((x) => x.id === "oauth")?.detail).toContain("check the URL");
  });

  test("mobile-app client rejected → incompatible", async () => {
    const r = await check({ tokenError: { status: 400, body: { error: "invalid_client" } } });
    expect(statusOf(r, "oauth")).toBe("fail");
  });

  test("not an itslearning page / unreachable → stops early", async () => {
    const other = await check({ startPage: { status: 200, body: "<html>Some other site</html>" } });
    expect(other.results).toHaveLength(1);
    expect(other.verdict).toBe("incompatible");
    const down = await check({ startPage: "network-error" });
    expect(down.results[0]).toMatchObject({ id: "reachable", status: "fail" });
  });

  test("unrecognisable login page → warning only", async () => {
    const r = await check({ startPage: { status: 200, body: "<html>itslearning</html>" } });
    expect(statusOf(r, "login-mode")).toBe("warn");
    expect(r.verdict).toBe("partial");
  });
});

describe("compatibility check – with credentials", () => {
  const creds = { username: "fake.user.42", password: "pw-xyz-123" };

  test("full run → compatible, counts only, no names in the output", async () => {
    const r = await check({ validLogin: creds }, { credentials: creds });
    expect(r.loginTested).toBe(true);
    expect(r.verdict).toBe("compatible");
    expect(r.results.map((x) => x.id)).toEqual([
      "reachable", "login-mode", "rest-api", "oauth", "login", "refresh", "account", "courses", "tasks", "news", "messages", "course-files", "participants", "downloads",
    ]);
    expect(r.results.find((x) => x.id === "participants")?.detail).toBe("3 participant(s) readable");
    expect(JSON.stringify(r.results)).not.toMatch(/Testina|Fakeperson|fake.user|pw-xyz|Signature/);
  });

  test("credentials are never sent if a public check failed", async () => {
    const r = await check(
      { validLogin: creds, tokenError: { status: 401, body: { ErrorCode: "Customer does not exist or is disabled" } } },
      { credentials: creds },
    );
    expect(r.results.at(-1)).toMatchObject({ id: "login", status: "skip" });
    // only the probe login with the random user name reached the token endpoint
    expect(r.requests.filter((x) => x === "POST /restapi/oauth2/token")).toHaveLength(1);
  });

  test("credentials are never sent to a non-itslearning host", async () => {
    const { fetchImpl, requests } = fakeInstance({ validLogin: creds });
    const r = await runCheck({ baseUrl: "https://lms.example.org", fetchImpl, credentials: creds });
    expect(r.results.at(-1)).toMatchObject({ id: "login", status: "skip" });
    expect(requests.filter((x) => x === "POST /restapi/oauth2/token")).toHaveLength(1);
  });

  test("wrong password → fail, no further checks", async () => {
    const r = await check({ validLogin: creds }, { credentials: { username: "fake.user.42", password: "wrong" } });
    expect(r.results.at(-1)).toMatchObject({ id: "login", status: "fail", detail: "wrong user name or password" });
    expect(r.verdict).toBe("incompatible");
  });

  test("parent account, no participants, no SSO URL, refresh broken → partial with warnings", async () => {
    const r = await check({ validLogin: creds, children: [{}], participantsStatus: 403, ssoUrl: false, refreshWorks: false }, { credentials: creds });
    expect(statusOf(r, "account")).toBe("warn");
    expect(statusOf(r, "participants")).toBe("warn");
    expect(statusOf(r, "downloads")).toBe("warn");
    expect(statusOf(r, "refresh")).toBe("warn");
    expect(r.verdict).toBe("partial");
  });
});
