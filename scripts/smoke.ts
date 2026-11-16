/**
 * Smoke-Test gegen eine ECHTE itslearning-Instanz (Spec 11.2).
 *
 *   bun run smoke            → ruft jedes Tool einmal auf und prüft alle Ausgaben auf Leaks
 *   bun run smoke --details  → zeigt bei Treffern zusätzlich maskierte Begriffe (z. B. "S****")
 *
 * Funktionsweise: Server läuft im selben Prozess (ein Login, gleicher DATA_DIR wie sonst).
 * Die echten Namen holt das Skript direkt über die API und prüft, ob sie in Tool-Ausgaben auftauchen.
 * AUSGEGEBEN WERDEN NUR ZÄHLUNGEN – keine Namen, keine Inhalte. Die Ausgabe kann man teilen.
 *
 * Zugangsdaten: .env bzw. ITSL_BASE_URL / ITSL_USERNAME / ITSL_PASSWORD, sonst interaktive Abfrage.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { setLogLevel } from "../src/log";
import { BASE, promptCredentials } from "./lib";
import { runSmoke } from "./smokeCore";


// ---------- Setup ----------

if (!process.env.ITSL_USERNAME || !process.env.ITSL_PASSWORD || !process.env.ITSL_BASE_URL) {
  const creds = await promptCredentials();
  process.env.ITSL_BASE_URL = BASE;
  process.env.ITSL_USERNAME = creds.username;
  process.env.ITSL_PASSWORD = creds.password;
}
process.env.DATA_DIR ??= ".data";
process.env.MCP_TRANSPORT = "stdio";
const cfg = loadConfig();
setLogLevel("error");

const { ctx, server } = createApp(cfg);
const client = new Client({ name: "smoke", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);

console.log(`Smoke-Test → ${cfg.baseUrl}\n`);

const result = await runSmoke(ctx, client, { redactTeachers: cfg.redactTeachers, details: process.argv.includes("--details") });
await client.close();
process.exit(result.leaks === 0 ? 0 : 1);
