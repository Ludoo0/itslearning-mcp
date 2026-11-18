import { describe, expect, test } from "bun:test";
import { downloadFile } from "../src/tools/files";
import { createFakeWeb, SECRET_MARKERS, type ShortcutMode } from "./fakeWeb";
import { fakeContext } from "./fixtures";

type Structured = Record<string, unknown> & { text?: string };

const FULL_CHAIN = [
  "demo.itslearning.com/SSO/MobileAppLoginSso.aspx",
  "demo.itslearning.com/ProcessLogin.aspx",
  "demo.itslearning.com/LearningToolElement/ViewLearningToolElement.aspx",
  "platform.itslearning.com/LoginSSO.aspx",
  "resource.itslearning.com/File/View.aspx",
  "resource.itslearning.com/Proxy/DownloadRedirect.ashx",
  "filerepository.itslearning.com/f1",
  "filecache.itslearning.com/c/f1",
];
const SHORTCUT = [
  "resource.itslearning.com/Proxy/DownloadRedirect.ashx",
  "filerepository.itslearning.com/f3",
  "filecache.itslearning.com/c/f3",
];
const SOLUTIONS = { kind: "file", name: "Solutions_Me.txt", text: "Solutions for Me\nTask 1: 7/8" };

async function setup() {
  const web = createFakeWeb();
  const ctx = await fakeContext({}, { web });
  const since = () => {
    const start = web.stats.requests.length;
    return () => web.stats.requests.slice(start);
  };
  return { web, ctx, since };
}

describe("DownloadRedirect shortcut for course files", () => {
  test("first download takes the full chain, the next one of another element the shortcut", async () => {
    const { ctx, since } = await setup();
    let reqs = since();
    const first = await downloadFile(ctx, { fileRef: "e_7201" });
    expect(first.structuredContent).toMatchObject({ kind: "file", name: "Worksheet_Me_Me.txt" });
    expect(reqs()).toEqual(FULL_CHAIN);

    reqs = since();
    const second = await downloadFile(ctx, { fileRef: "e_7203" });
    expect(second.structuredContent).toMatchObject(SOLUTIONS);
    expect(reqs()).toEqual(SHORTCUT);
    expect(reqs()).not.toContain("platform.itslearning.com/LoginSSO.aspx");
    expect(reqs()).not.toContain("resource.itslearning.com/File/View.aspx");
  });

  test("shortcut result equals the full-chain result", async () => {
    const viaChain = await downloadFile(await fakeContext(), { fileRef: "e_7203" });
    const { ctx } = await setup();
    await downloadFile(ctx, { fileRef: "e_7201" });
    const viaShortcut = await downloadFile(ctx, { fileRef: "e_7203" });
    expect(viaShortcut.structuredContent).toEqual(viaChain.structuredContent as Structured);
    expect(viaShortcut.content).toEqual(viaChain.content);
  });

  for (const mode of ["html", "login", "status", "network"] as ShortcutMode[]) {
    test(`shortcut failure (${mode}) → silent fallback to the full chain`, async () => {
      const { web, ctx, since } = await setup();
      await downloadFile(ctx, { fileRef: "e_7201" });
      web.setShortcutMode(mode);
      const reqs = since();
      const res = await downloadFile(ctx, { fileRef: "e_7203" });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent).toMatchObject(SOLUTIONS);
      const r = reqs();
      expect(r[0]).toBe("resource.itslearning.com/Proxy/DownloadRedirect.ashx"); // shortcut attempt
      expect(r.slice(1)).toEqual(FULL_CHAIN.map((p) => p.replace(/f1$/, "f3")));
    });
  }

  test("non-file element: shortcut yields HTML → full chain returns the page as before", async () => {
    const { ctx, since } = await setup();
    await downloadFile(ctx, { fileRef: "e_7201" });
    const reqs = since();
    const res = await downloadFile(ctx, { fileRef: "e_7202" });
    expect(res.structuredContent).toMatchObject({ kind: "page" });
    expect((res.structuredContent as Structured).text).toContain("Note");
    expect(reqs()).toContain("demo.itslearning.com/LearningToolElement/ViewLearningToolElement.aspx");
  });

  test("not used without ids from the API, and not before the resource server was reached", async () => {
    const { ctx, since } = await setup();
    // element without LearningObject ids (7101) first: full chain, origin is learned from it
    let reqs = since();
    await downloadFile(ctx, { fileRef: "e_7101" });
    expect(reqs()).toEqual(FULL_CHAIN);
    // the same file again without ids → full chain again (no shortcut, no cache configured)
    reqs = since();
    await downloadFile(ctx, { fileRef: "e_7101" });
    expect(reqs()).toEqual(FULL_CHAIN);
  });

  test("expired resource session → shortcut fails, the full chain renews the session", async () => {
    const { web, ctx, since } = await setup();
    await downloadFile(ctx, { fileRef: "e_7201" });
    web.expireSessionOnce();
    web.setShortcutMode("login");
    const reqs = since();
    const res = await downloadFile(ctx, { fileRef: "e_7203" });
    expect(res.structuredContent).toMatchObject(SOLUTIONS);
    expect(web.stats.loginPagesServed).toBe(1);
    expect(reqs()[0]).toBe("resource.itslearning.com/Proxy/DownloadRedirect.ashx");
  });

  test("gives up after repeated failures (no wasted request per download)", async () => {
    const { web, ctx, since } = await setup();
    await downloadFile(ctx, { fileRef: "e_7201" });
    web.setShortcutMode("html");
    for (let i = 0; i < 3; i++) await downloadFile(ctx, { fileRef: i % 2 ? "e_7201" : "e_7203" });
    const reqs = since();
    const res = await downloadFile(ctx, { fileRef: "e_7203" });
    expect(res.structuredContent).toMatchObject(SOLUTIONS);
    expect(reqs()).toEqual(FULL_CHAIN.map((p) => p.replace(/f1$/, "f3")));
  });

  test("no secrets, session URLs or names leak via the shortcut or its fallback", async () => {
    const outputs: string[] = [];
    for (const mode of ["ok", "html", "network"] as ShortcutMode[]) {
      const { web, ctx } = await setup();
      outputs.push(JSON.stringify(await downloadFile(ctx, { fileRef: "e_7201" })));
      web.setShortcutMode(mode);
      outputs.push(JSON.stringify(await downloadFile(ctx, { fileRef: "e_7203" })));
      outputs.push(JSON.stringify(await downloadFile(ctx, { fileRef: "e_7202" })));
    }
    const all = outputs.join("\n");
    for (const m of SECRET_MARKERS) expect(all, `secret "${m}"`).not.toContain(m);
    expect(all).not.toMatch(/filerepository|filecache|LoginSSO|DownloadRedirect|LearningObjectId|81203|91203|itslearning\.com\//);
    expect(all).not.toMatch(/\bJonas\b|Beispielmann/);
  });
});
