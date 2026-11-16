#!/usr/bin/env bun
/**
 * Einstiegspunkt des itslearning-MCP-Servers.
 * M1: stdio-Transport. Streamable HTTP + API-Key folgen in Meilenstein 4.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { log, setLogLevel } from "./log";

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    process.stderr.write(`${e instanceof ConfigError ? e.message : "Konfiguration konnte nicht geladen werden."}\n`);
    process.exit(2);
  }
  setLogLevel(cfg.logLevel);

  if (cfg.transport === "http") {
    log.error("MCP_TRANSPORT=http ist noch nicht implementiert (Meilenstein 4) – bitte MCP_TRANSPORT=stdio verwenden");
    process.exit(2);
  }

  const { ctx, server } = createApp(cfg);

  // Früh anmelden, damit Fehler sofort im Log stehen. Der Server startet trotzdem:
  // Tools melden den Fehler dann strukturiert (und bei falschem Passwort ohne erneuten Login-Versuch).
  ctx.ensureReady().catch(() => {});

  await server.connect(new StdioServerTransport());
  log.info("itslearning-MCP-Server läuft", { transport: "stdio", instance: cfg.baseUrl });

  const shutdown = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  log.error("Server-Start fehlgeschlagen", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
