import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore } from "../src/auth/tokenStore";
import { ToolError } from "../src/errors";

type Call = { grant: string; refresh?: string };

function tokenServer(behaviour: (call: Call, n: number) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body));
    const call = { grant: params.get("grant_type") ?? "", refresh: params.get("refresh_token") ?? undefined };
    calls.push(call);
    const { status, body } = behaviour(call, calls.length);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "itsl-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cfg = () => ({ baseUrl: "https://demo.itslearning.com", username: "u", password: "pw", clientId: "cid", dataDir: dir });

describe("TokenStore", () => {
  test("password login stores the refresh token in state.json", async () => {
    const { calls, fetchImpl } = tokenServer(() => ({ status: 200, body: { access_token: "A1", refresh_token: "R1", expires_in: 300 } }));
    const ts = new TokenStore(cfg(), fetchImpl);
    expect(await ts.getAccessToken()).toBe("A1");
    expect(calls.map((c) => c.grant)).toEqual(["password"]);
    const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    expect(state.refreshToken).toBe("R1");
    expect(state.baseUrl).toBe("https://demo.itslearning.com");
    if (process.platform !== "win32") expect((await stat(join(dir, "state.json"))).mode & 0o777).toBe(0o600);
  });

  test("refreshes 30 s before expiry and stores the rotating refresh token", async () => {
    let now = 0;
    const { calls, fetchImpl } = tokenServer((call, n) =>
      call.grant === "password"
        ? { status: 200, body: { access_token: "A1", refresh_token: "R1", expires_in: 300 } }
        : { status: 200, body: { access_token: `A${n}`, refresh_token: `R${n}`, expires_in: 300 } },
    );
    const ts = new TokenStore(cfg(), fetchImpl, () => now);
    await ts.getAccessToken();
    now = 260_000; // still valid for 40 s → no refresh
    expect(await ts.getAccessToken()).toBe("A1");
    now = 275_000; // < 30 s → refresh
    expect(await ts.getAccessToken()).toBe("A2");
    expect(calls).toEqual([{ grant: "password", refresh: undefined }, { grant: "refresh_token", refresh: "R1" }]);
    const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    expect(state.refreshToken).toBe("R2");
  });

  test("concurrent calls trigger only one login", async () => {
    const { calls, fetchImpl } = tokenServer(() => ({ status: 200, body: { access_token: "A1", refresh_token: "R1", expires_in: 300 } }));
    const ts = new TokenStore(cfg(), fetchImpl);
    const tokens = await Promise.all([ts.getAccessToken(), ts.getAccessToken(), ts.getAccessToken()]);
    expect(tokens).toEqual(["A1", "A1", "A1"]);
    expect(calls).toHaveLength(1);
  });

  test("uses the stored refresh token after a restart", async () => {
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({ baseUrl: "https://demo.itslearning.com", username: "u", refreshToken: "R-alt", updatedAt: "x" }),
    );
    const { calls, fetchImpl } = tokenServer(() => ({ status: 200, body: { access_token: "A9", refresh_token: "R-neu", expires_in: 300 } }));
    const ts = new TokenStore(cfg(), fetchImpl);
    expect(await ts.getAccessToken()).toBe("A9");
    expect(calls).toEqual([{ grant: "refresh_token", refresh: "R-alt" }]);
  });

  test("ignores state.json of another instance", async () => {
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({ baseUrl: "https://andere.itslearning.com", username: "u", refreshToken: "R-fremd", updatedAt: "x" }),
    );
    const { calls, fetchImpl } = tokenServer(() => ({ status: 200, body: { access_token: "A1", refresh_token: "R1", expires_in: 300 } }));
    await new TokenStore(cfg(), fetchImpl).getAccessToken();
    expect(calls.map((c) => c.grant)).toEqual(["password"]);
  });

  test("invalid refresh token → falls back to password", async () => {
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({ baseUrl: "https://demo.itslearning.com", username: "u", refreshToken: "R-tot", updatedAt: "x" }),
    );
    const { calls, fetchImpl } = tokenServer((call) =>
      call.grant === "refresh_token"
        ? { status: 400, body: { error: "invalid_grant" } }
        : { status: 200, body: { access_token: "A1", refresh_token: "R1", expires_in: 300 } },
    );
    expect(await new TokenStore(cfg(), fetchImpl).getAccessToken()).toBe("A1");
    expect(calls.map((c) => c.grant)).toEqual(["refresh_token", "password"]);
  });

  test("wrong password is fatal: no second login attempt", async () => {
    const { calls, fetchImpl } = tokenServer(() => ({ status: 401, body: { ErrorCode: "InvalidUser" } }));
    const ts = new TokenStore(cfg(), fetchImpl);
    const err1 = await ts.getAccessToken().catch((e) => e);
    const err2 = await ts.getAccessToken().catch((e) => e);
    expect(err1).toBeInstanceOf(ToolError);
    expect((err1 as ToolError).code).toBe("AUTH_FAILED");
    expect((err1 as ToolError).fatal).toBe(true);
    expect(err2).toBe(err1);
    expect(calls).toHaveLength(1);
  });

  test("unknown instance → understandable message", async () => {
    const { fetchImpl } = tokenServer(() => ({ status: 401, body: { ErrorCode: "Customer does not exist or is disabled" } }));
    const err = (await new TokenStore(cfg(), fetchImpl).getAccessToken().catch((e) => e)) as ToolError;
    expect(err.message).toContain("ITSL_BASE_URL");
  });

  test("itslearning down (5xx) during refresh → no password login", async () => {
    await writeFile(
      join(dir, "state.json"),
      JSON.stringify({ baseUrl: "https://demo.itslearning.com", username: "u", refreshToken: "R1", updatedAt: "x" }),
    );
    const { calls, fetchImpl } = tokenServer(() => ({ status: 503, body: {} }));
    const err = (await new TokenStore(cfg(), fetchImpl).getAccessToken().catch((e) => e)) as ToolError;
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(calls.map((c) => c.grant)).toEqual(["refresh_token"]);
  });
});
