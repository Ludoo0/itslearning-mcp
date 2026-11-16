import { describe, expect, test } from "bun:test";
import { ApiClient } from "../src/api/client";
import { ToolError } from "../src/errors";

const cfg = { baseUrl: "https://demo.itslearning.com", cacheTtlS: 60, maxConcurrency: 2, minRequestIntervalMs: 0 };
const noSleep = async () => {};

function fakeAuth() {
  let n = 0;
  const auth = {
    invalidated: 0,
    getAccessToken: async () => `T${n}`,
    invalidate() {
      auth.invalidated++;
      n++;
    },
  };
  return auth;
}

function server(responses: (() => Response)[]) {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("keine Antwort mehr");
    return next();
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers });

describe("ApiClient", () => {
  test("setzt Pfad-Parameter, Query und Bearer", async () => {
    const { seen, fetchImpl } = server([json({ ok: 1 })]);
    const api = new ApiClient(cfg, fakeAuth(), fetchImpl, noSleep);
    await api.get("/restapi/personal/courses/{courseId}/tasks/v1", { courseId: 42 }, { PageSize: 10, skip: undefined });
    expect(seen[0]!.url).toBe("https://demo.itslearning.com/restapi/personal/courses/42/tasks/v1?PageSize=10");
    expect(seen[0]!.auth).toBe("Bearer T0");
  });

  test("401 → Token verwerfen und einmal wiederholen", async () => {
    const auth = fakeAuth();
    const { seen, fetchImpl } = server([json({}, 401), json({ ok: 1 })]);
    const res = await new ApiClient(cfg, auth, fetchImpl, noSleep).get<{ ok: number }>("/x");
    expect(res.ok).toBe(1);
    expect(auth.invalidated).toBe(1);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer T0", "Bearer T1"]);
  });

  test("5xx/429 → Retry mit Backoff, danach Erfolg", async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = server([json({}, 503), json({}, 429, { "retry-after": "2" }), json({ ok: 1 })]);
    const api = new ApiClient(cfg, fakeAuth(), fetchImpl, async (ms) => {
      sleeps.push(ms);
    });
    expect((await api.get<{ ok: number }>("/x")).ok).toBe(1);
    expect(sleeps).toEqual([500, 2000]);
  });

  test("403/404 → ToolError ohne Rohtext der API", async () => {
    const { fetchImpl } = server([json({ Message: "PersonId=4711 does not have Read permission" }, 403)]);
    const err = (await new ApiClient(cfg, fakeAuth(), fetchImpl, noSleep).get("/x").catch((e) => e)) as ToolError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toContain("4711");
  });

  test("Cache: gleicher Request innerhalb der TTL nur einmal", async () => {
    const { seen, fetchImpl } = server([json({ n: 1 })]);
    const api = new ApiClient(cfg, fakeAuth(), fetchImpl, noSleep);
    const [a, b] = await Promise.all([api.get<{ n: number }>("/x"), api.get<{ n: number }>("/x")]);
    expect(a.n).toBe(1);
    expect(b.n).toBe(1);
    expect(seen).toHaveLength(1);
  });

  test("Fehler werden nicht gecacht", async () => {
    const { seen, fetchImpl } = server([json({}, 404), json({ n: 2 })]);
    const api = new ApiClient(cfg, fakeAuth(), fetchImpl, noSleep);
    await api.get("/x").catch(() => {});
    expect((await api.get<{ n: number }>("/x")).n).toBe(2);
    expect(seen).toHaveLength(2);
  });
});
