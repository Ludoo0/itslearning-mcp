/**
 * Smoke test against a REAL itslearning instance (spec 11.2).
 *
 *   bun run smoke            → calls every tool once and checks all output for leaks
 *   bun run smoke --details  → additionally shows masked terms for hits (e.g. "S****") and their structure
 *
 * How it works: the server runs in the same process (one login, same DATA_DIR as usual).
 * The script fetches the real names directly from the API and checks whether they appear in tool output.
 * ONLY COUNTS ARE PRINTED – no names, no content. The output can be shared.
 *
 * Credentials: .env or ITSL_BASE_URL / ITSL_USERNAME / ITSL_PASSWORD, otherwise interactive prompt.
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

console.log(`Smoke test → ${cfg.baseUrl}\n`);

const result = await runSmoke(ctx, client, { redactTeachers: cfg.redactTeachers, details: process.argv.includes("--details") });
await client.close();
process.exit(result.leaks === 0 ? 0 : 1);
