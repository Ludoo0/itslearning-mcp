import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/app";
import type { AppContext } from "../src/context";
import { runSmoke } from "../scripts/smokeCore";
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

describe("Smoke-Test (Logik, gegen Fake-Daten)", () => {
  test("saubere Daten → 0 Leaks, alle Tools aufgerufen, Teilnehmerlisten-Status gemeldet", async () => {
    const res = await smoke(await fakeContext());
    expect(res.leaks).toBe(0);
    const tools = new Set(res.runs.map((r) => r.tool.split(" ")[0]));
    expect(tools.size).toBe(10);
    expect(Object.values(res.participantsStatus).join(" ")).toContain("abrufbar");
    // Ausgabe des Smoke-Tests selbst enthält keine Namen
    expect(res.output).not.toMatch(/Jonas|Beispielmann|Sabine|Mia|Sonnenfeld|Lindqvist/);
  });

  test("absichtlich kaputte Schwärzung wird erkannt", async () => {
    const ctx = await fakeContext();
    ctx.redactor.text = (s) => s ?? ""; // Schwärzung ausgeschaltet
    const res = await smoke(ctx);
    expect(res.leaks).toBeGreaterThan(0);
    expect(res.output).toContain("❌");
    expect(res.output).not.toMatch(/Jonas|Beispielmann|Sabine|Sonnenfeld/); // nur maskiert
  });

  test("--details zeigt bei Muster-Treffern nur die Struktur (x/9), keinen Inhalt", async () => {
    const ctx = await fakeContext();
    const orig = ctx.redactor.text.bind(ctx.redactor);
    ctx.redactor.text = (s, max) => orig(s, max) + " Profil-ID PersonId=4711 von Mia";
    const res = await smoke(ctx);
    expect(res.output).toMatch(/Struktur: ….*PersonId=9999/);
    expect(res.output).not.toMatch(/4711|Mia|Profil/);
  });

  test("Namens-Treffer: Struktur mit lesbaren Anzeigewörtern, Name nur als ⟨Treffer⟩", async () => {
    const ctx = await fakeContext();
    const orig = ctx.redactor.text.bind(ctx.redactor);
    ctx.redactor.text = (s, max) => orig(s, max) + " Grüße an Lehrkraft Lindqvist und Sabine";
    const res = await smoke(ctx);
    expect(res.output).toMatch(/Lehrkraft: Vorname: 1 Treffer \(s\*+\)/);
    expect(res.output).toMatch(/Struktur: ….*Lehrkraft xxxxxxxxx xxx ⟨Treffer⟩/);
    expect(res.output).not.toMatch(/Sabine|Lindqvist|Grüße/);
  });

  test("Kurs-Teilnehmer:innen im Format 'Nachname, Vorname': Nachname der Lehrkraft ist kein Fehlalarm", async () => {
    // Fake-Kurs 12 liefert "Lindqvist, Sabine" – "Lehrkraft Lindqvist" in Ausgaben ist erlaubt
    const res = await smoke(await fakeContext());
    expect(res.leaks).toBe(0);
  });
});
