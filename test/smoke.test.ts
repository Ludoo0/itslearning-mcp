import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runSmoke } from "../scripts/smokeCore";
import { createServer } from "../src/app";
import type { AppContext } from "../src/context";
import { fakeContext } from "./fixtures";

async function smoke(ctx: AppContext) {
  const server = createServer(ctx);
  const client = new Client({ name: "smoke-test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const lines: string[] = [];
  const res = await runSmoke(ctx, client, { redactTeachers: false, details: true, out: (l) => lines.push(l) });
  await client.close();
  return { ...res, output: lines.join("\n") };
}

describe("smoke test (logic, against fake data)", () => {
  test("clean data → 0 leaks, all tools called, participant list status reported", async () => {
    const res = await smoke(await fakeContext());
    expect(res.leaks).toBe(0);
    const tools = new Set(res.runs.map((r) => r.tool.split(" ")[0]));
    expect(tools.size).toBe(13);
    expect(Object.values(res.participantsStatus).join(" ")).toContain("available");
    // the smoke test's own output contains no names
    expect(res.output).not.toMatch(/Jonas|Beispielmann|Sabine|Mia|Sonnenfeld|Lindqvist/);
  });

  test("deliberately broken redaction is detected", async () => {
    const ctx = await fakeContext();
    ctx.redactor.text = (s) => s ?? ""; // redaction switched off
    const res = await smoke(ctx);
    expect(res.leaks).toBeGreaterThan(0);
    expect(res.output).toContain("❌");
    expect(res.output).not.toMatch(/Jonas|Beispielmann|Sabine|Sonnenfeld/); // masked only
  });

  test("--details shows only the structure (x/9) for pattern hits, no content", async () => {
    const ctx = await fakeContext();
    const orig = ctx.redactor.text.bind(ctx.redactor);
    ctx.redactor.text = (s, max) => `${orig(s, max)} profile id PersonId=4711 of Mia`;
    const res = await smoke(ctx);
    expect(res.output).toMatch(/structure: ….*PersonId=9999/);
    expect(res.output).not.toMatch(/4711|Mia|profile/);
  });

  test("name hits: structure with readable display words, the name only as ⟨hit⟩", async () => {
    const ctx = await fakeContext();
    const orig = ctx.redactor.text.bind(ctx.redactor);
    ctx.redactor.text = (s, max) => `${orig(s, max)} Greetings to Teacher Lindqvist and Sabine`;
    const res = await smoke(ctx);
    expect(res.output).toMatch(/teacher: first name: 1 hit\(s\) \(s\*+\)/);
    expect(res.output).toMatch(/structure: ….*Teacher xxxxxxxxx xxx ⟨hit⟩/);
    expect(res.output).not.toMatch(/Sabine|Lindqvist|Greetings/);
  });

  test("German display words stay readable too", async () => {
    const ctx = await fakeContext({}, { language: "de" });
    const orig = ctx.redactor.text.bind(ctx.redactor);
    ctx.redactor.text = (s, max) => `${orig(s, max)} Grüße an Lehrkraft Lindqvist und Sabine`;
    const res = await smoke(ctx);
    expect(res.output).toMatch(/structure: ….*Lehrkraft xxxxxxxxx xxx ⟨hit⟩/);
  });

  test("course participants as 'Last, First': the teacher's last name is no false positive", async () => {
    // fake course 12 returns "Lindqvist, Sabine" – "Teacher Lindqvist" in output is allowed
    const res = await smoke(await fakeContext());
    expect(res.leaks).toBe(0);
  });
});
